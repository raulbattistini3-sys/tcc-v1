// Windows process, job, system, PDH and ETW observation for Node, as a Node-API addon.
//
// Node-API only (no V8, no nan): the same binary loads in any Node >= 18 and in Bun. The napi_* functions are
// looked up at load time in the host executable (GetProcAddress), so the addon links against no node.lib and
// builds with MinGW g++ or MSVC alike (scripts/build.mjs).
//
// Everything the JS side asks is answered synchronously from cheap calls (GetProcessMemoryInfo,
// QueryInformationJobObject, GetSystemTimes, PdhCollectQueryData), except ETW: a real-time session consumed on
// its own thread into a bounded ring (drop-oldest, counted), drained from JS. The thread never calls into JS;
// it only signals "events waiting" through a thread-safe function, at most one signal until the next drain.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <evntcons.h>
#include <evntrace.h>
#include <pdh.h>
#include <pdhmsg.h>
#include <psapi.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif
#include <node_api.h>

#ifndef EVENT_FILTER_TYPE_PID
#define EVENT_FILTER_TYPE_PID 0x80000004
#endif
#ifndef MAX_EVENT_FILTER_PID_COUNT
#define MAX_EVENT_FILTER_PID_COUNT 8
#endif
#ifndef ENABLE_TRACE_PARAMETERS_VERSION_2
#define ENABLE_TRACE_PARAMETERS_VERSION_2 2
#endif
static const TRACEHANDLE kInvalidTrace = (TRACEHANDLE)(INT_PTR)-1;  // INVALID_PROCESSTRACE_HANDLE

// ---------------------------------------------------------------------------------------------------------------
// Node-API, resolved from the host process

#define NAPI_FUNCS(X)                                                                                              \
  X(napi_create_object)                                                                                            \
  X(napi_create_array_with_length)                                                                                 \
  X(napi_create_string_utf8)                                                                                       \
  X(napi_create_double)                                                                                            \
  X(napi_create_function)                                                                                          \
  X(napi_get_boolean)                                                                                              \
  X(napi_get_null)                                                                                                 \
  X(napi_get_undefined)                                                                                            \
  X(napi_set_named_property)                                                                                       \
  X(napi_get_named_property)                                                                                       \
  X(napi_has_named_property)                                                                                       \
  X(napi_set_element)                                                                                              \
  X(napi_get_element)                                                                                              \
  X(napi_get_array_length)                                                                                         \
  X(napi_is_array)                                                                                                 \
  X(napi_typeof)                                                                                                   \
  X(napi_get_cb_info)                                                                                              \
  X(napi_get_value_string_utf8)                                                                                    \
  X(napi_get_value_double)                                                                                         \
  X(napi_get_value_bool)                                                                                           \
  X(napi_throw_error)                                                                                              \
  X(napi_call_function)                                                                                            \
  X(napi_create_threadsafe_function)                                                                               \
  X(napi_call_threadsafe_function)                                                                                 \
  X(napi_release_threadsafe_function)                                                                              \
  X(napi_unref_threadsafe_function)                                                                                \
  X(napi_add_env_cleanup_hook)

struct Api {
#define DECLARE(name) decltype(&::name) name;
  NAPI_FUNCS(DECLARE)
#undef DECLARE
};
static Api N;

static bool resolveApi(std::string& missing) {
  HMODULE hosts[] = {GetModuleHandleW(nullptr), GetModuleHandleW(L"libnode.dll"), GetModuleHandleW(L"node.dll")};
  auto find = [&](const char* name) -> FARPROC {
    for (HMODULE h : hosts)
      if (h)
        if (FARPROC p = GetProcAddress(h, name)) return p;
    return nullptr;
  };
#define RESOLVE(name)                                                                                              \
  N.name = reinterpret_cast<decltype(&::name)>(find(#name));                                                       \
  if (!N.name) missing += (missing.empty() ? "" : ", ") + std::string(#name);
  NAPI_FUNCS(RESOLVE)
#undef RESOLVE
  return missing.empty();
}

// ---------------------------------------------------------------------------------------------------------------
// small helpers

static std::wstring widen(const std::string& s) {
  if (s.empty()) return std::wstring();
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &w[0], n);
  return w;
}

static std::string narrow(const wchar_t* w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  if (n <= 1) return std::string();
  std::string s(n - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
  return s;
}

static std::string winError(DWORD code) {
  char buf[512] = {0};
  DWORD n = FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, code, 0, buf,
                           sizeof buf, nullptr);
  while (n && (buf[n - 1] == '\n' || buf[n - 1] == '\r' || buf[n - 1] == '.')) buf[--n] = 0;
  char out[600];
  snprintf(out, sizeof out, "%s (Win32 error %lu)", n ? buf : "unknown error", (unsigned long)code);
  return out;
}

static double ft100ns(const FILETIME& ft) {  // a duration FILETIME, in ms
  ULARGE_INTEGER u;
  u.LowPart = ft.dwLowDateTime;
  u.HighPart = ft.dwHighDateTime;
  return (double)u.QuadPart / 10000.0;
}

static double unixMs(int64_t filetime) { return (double)(filetime - 116444736000000000LL) / 10000.0; }

static napi_value throwError(napi_env env, const std::string& msg) {
  N.napi_throw_error(env, nullptr, msg.c_str());
  return nullptr;
}

static napi_value nullValue(napi_env env) {
  napi_value v;
  N.napi_get_null(env, &v);
  return v;
}

static napi_value number(napi_env env, double x) {
  napi_value v;
  N.napi_create_double(env, x, &v);
  return v;
}

static napi_value string(napi_env env, const std::string& s) {
  napi_value v;
  N.napi_create_string_utf8(env, s.data(), s.size(), &v);
  return v;
}

struct Obj {
  napi_env env;
  napi_value value;
  explicit Obj(napi_env e) : env(e) { N.napi_create_object(e, &value); }
  Obj& set(const char* k, napi_value v) {
    N.napi_set_named_property(env, value, k, v);
    return *this;
  }
  Obj& num(const char* k, double x) { return set(k, number(env, x)); }
  Obj& str(const char* k, const std::string& s) { return set(k, string(env, s)); }
  Obj& boolean(const char* k, bool b) {
    napi_value v;
    N.napi_get_boolean(env, b, &v);
    return set(k, v);
  }
};

struct Args {
  napi_value argv[4];
  size_t argc = 4;
  Args(napi_env env, napi_callback_info info) { N.napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr); }
};

static napi_valuetype typeOf(napi_env env, napi_value v) {
  napi_valuetype t = napi_undefined;
  if (v) N.napi_typeof(env, v, &t);
  return t;
}

static bool getString(napi_env env, napi_value v, std::string& out) {
  if (typeOf(env, v) != napi_string) return false;
  size_t len = 0;
  N.napi_get_value_string_utf8(env, v, nullptr, 0, &len);
  out.assign(len, '\0');
  N.napi_get_value_string_utf8(env, v, &out[0], len + 1, &len);
  return true;
}

static bool getNumber(napi_env env, napi_value v, double& out) {
  if (typeOf(env, v) != napi_number) return false;
  N.napi_get_value_double(env, v, &out);
  return true;
}

static napi_value prop(napi_env env, napi_value obj, const char* k) {
  bool has = false;
  if (typeOf(env, obj) != napi_object || N.napi_has_named_property(env, obj, k, &has) != napi_ok || !has)
    return nullptr;
  napi_value v;
  N.napi_get_named_property(env, obj, k, &v);
  return v;
}

static bool getArray(napi_env env, napi_value v, std::vector<napi_value>& out, uint32_t max) {
  bool isArray = false;
  if (!v || N.napi_is_array(env, v, &isArray) != napi_ok || !isArray) return false;
  uint32_t n = 0;
  N.napi_get_array_length(env, v, &n);
  if (n > max) n = max;
  out.resize(n);
  for (uint32_t i = 0; i < n; i++) N.napi_get_element(env, v, i, &out[i]);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// processInfo(pid?): memory, CPU time, handles, GUI objects, I/O of this process (or another one we may open)

static napi_value ProcessInfo(napi_env env, napi_callback_info info) {
  Args a(env, info);
  double pidArg = 0;
  DWORD self = GetCurrentProcessId();
  DWORD pid = a.argc > 0 && getNumber(env, a.argv[0], pidArg) ? (DWORD)pidArg : self;
  HANDLE h = pid == self ? GetCurrentProcess()
                         : OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid);
  if (!h) return nullValue(env);  // gone, or not ours to look at

  Obj o(env);
  o.num("pid", pid);
  PROCESS_MEMORY_COUNTERS_EX m;
  memset(&m, 0, sizeof m);
  if (GetProcessMemoryInfo(h, reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&m), sizeof m)) {
    o.num("workingSetBytes", (double)m.WorkingSetSize)
        .num("peakWorkingSetBytes", (double)m.PeakWorkingSetSize)
        .num("privateBytes", (double)m.PrivateUsage)
        .num("pagefileBytes", (double)m.PagefileUsage)
        .num("peakPagefileBytes", (double)m.PeakPagefileUsage)
        .num("pageFaults", (double)m.PageFaultCount);
  }
  FILETIME created, exited, kernel, user;
  if (GetProcessTimes(h, &created, &exited, &kernel, &user)) {
    ULARGE_INTEGER c;
    c.LowPart = created.dwLowDateTime;
    c.HighPart = created.dwHighDateTime;
    o.num("kernelMs", ft100ns(kernel)).num("userMs", ft100ns(user)).num("startedAt", unixMs((int64_t)c.QuadPart));
  }
  DWORD handles = 0;
  if (GetProcessHandleCount(h, &handles)) o.num("handles", handles);
  o.num("gdiObjects", GetGuiResources(h, GR_GDIOBJECTS)).num("userObjects", GetGuiResources(h, GR_USEROBJECTS));
  IO_COUNTERS io;
  if (GetProcessIoCounters(h, &io)) {
    o.num("ioReadBytes", (double)io.ReadTransferCount)
        .num("ioWriteBytes", (double)io.WriteTransferCount)
        .num("ioOtherBytes", (double)io.OtherTransferCount)
        .num("ioReadOps", (double)io.ReadOperationCount)
        .num("ioWriteOps", (double)io.WriteOperationCount);
  }
  if (pid != self) CloseHandle(h);
  return o.value;
}

// ---------------------------------------------------------------------------------------------------------------
// jobInfo(): the job object this process runs in (network's supervisor puts its children in one), or null

static napi_value JobInfo(napi_env env, napi_callback_info) {
  BOOL inJob = FALSE;
  if (!IsProcessInJob(GetCurrentProcess(), nullptr, &inJob) || !inJob) return nullValue(env);

  Obj o(env);
  JOBOBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION acc;
  if (QueryInformationJobObject(nullptr, JobObjectBasicAndIoAccountingInformation, &acc, sizeof acc, nullptr)) {
    const auto& b = acc.BasicInfo;
    o.num("userMs", (double)b.TotalUserTime.QuadPart / 10000.0)
        .num("kernelMs", (double)b.TotalKernelTime.QuadPart / 10000.0)
        .num("pageFaults", b.TotalPageFaultCount)
        .num("totalProcesses", b.TotalProcesses)
        .num("activeProcesses", b.ActiveProcesses)
        .num("terminatedProcesses", b.TotalTerminatedProcesses)
        .num("ioReadBytes", (double)acc.IoInfo.ReadTransferCount)
        .num("ioWriteBytes", (double)acc.IoInfo.WriteTransferCount)
        .num("ioReadOps", (double)acc.IoInfo.ReadOperationCount)
        .num("ioWriteOps", (double)acc.IoInfo.WriteOperationCount);
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext;
  if (QueryInformationJobObject(nullptr, JobObjectExtendedLimitInformation, &ext, sizeof ext, nullptr)) {
    o.num("peakProcessMemoryBytes", (double)ext.PeakProcessMemoryUsed)
        .num("peakJobMemoryBytes", (double)ext.PeakJobMemoryUsed)
        .num("limitFlags", ext.BasicLimitInformation.LimitFlags)
        .boolean("killOnClose", (ext.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) != 0);
    if (ext.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_JOB_MEMORY)
      o.num("jobMemoryLimitBytes", (double)ext.JobMemoryLimit);
  }
  struct {
    JOBOBJECT_BASIC_PROCESS_ID_LIST list;
    ULONG_PTR more[63];
  } ids;
  memset(&ids, 0, sizeof ids);
  if (QueryInformationJobObject(nullptr, JobObjectBasicProcessIdList, &ids, sizeof ids, nullptr) ||
      GetLastError() == ERROR_MORE_DATA) {
    DWORD n = ids.list.NumberOfProcessIdsInList;
    napi_value arr;
    N.napi_create_array_with_length(env, n, &arr);
    for (DWORD i = 0; i < n; i++) N.napi_set_element(env, arr, i, number(env, (double)ids.list.ProcessIdList[i]));
    o.set("pids", arr).boolean("pidsTruncated", ids.list.NumberOfAssignedProcesses > n);
  }
  return o.value;
}

// ---------------------------------------------------------------------------------------------------------------
// systemInfo(): memory, commit, CPU times (cumulative; the JS side turns them into percentages)

static napi_value SystemInfo(napi_env env, napi_callback_info) {
  Obj o(env);
  MEMORYSTATUSEX ms;
  ms.dwLength = sizeof ms;
  if (GlobalMemoryStatusEx(&ms)) {
    o.num("memoryLoadPct", ms.dwMemoryLoad)
        .num("totalPhysBytes", (double)ms.ullTotalPhys)
        .num("availPhysBytes", (double)ms.ullAvailPhys);
  }
  PERFORMANCE_INFORMATION pi;
  if (GetPerformanceInfo(&pi, sizeof pi)) {
    double page = (double)pi.PageSize;
    o.num("commitBytes", pi.CommitTotal * page)
        .num("commitLimitBytes", pi.CommitLimit * page)
        .num("systemCacheBytes", pi.SystemCache * page)
        .num("kernelPagedBytes", pi.KernelPaged * page)
        .num("kernelNonpagedBytes", pi.KernelNonpaged * page)
        .num("handles", pi.HandleCount)
        .num("processes", pi.ProcessCount)
        .num("threads", pi.ThreadCount);
  }
  FILETIME idle, kernel, user;
  if (GetSystemTimes(&idle, &kernel, &user)) {
    // kernel time includes idle time
    o.num("idleMs", ft100ns(idle)).num("kernelMs", ft100ns(kernel)).num("userMs", ft100ns(user));
  }
  o.num("processors", GetActiveProcessorCount(ALL_PROCESSOR_GROUPS));
  o.num("uptimeMs", (double)GetTickCount64());
  return o.value;
}

// ---------------------------------------------------------------------------------------------------------------
// isElevated(): ETW sessions need an elevated process or membership in "Performance Log Users"

static bool elevated() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
  TOKEN_ELEVATION e;
  DWORD n = 0;
  bool ok = GetTokenInformation(token, TokenElevation, &e, sizeof e, &n) && e.TokenIsElevated;
  CloseHandle(token);
  return ok;
}

static napi_value IsElevated(napi_env env, napi_callback_info) {
  napi_value v;
  N.napi_get_boolean(env, elevated(), &v);
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// PDH: pdhOpen(paths) -> id, pdhSample(id) -> (number|null)[], pdhClose(id)
// English counter paths ("\\Processor(_Total)\\% Processor Time"), no wildcards. Rate counters need two
// samples, so the first pdhSample after pdhOpen may give null for them.

struct PdhQuery {
  PDH_HQUERY query = nullptr;
  std::vector<PDH_HCOUNTER> counters;
};
static std::map<uint32_t, PdhQuery> pdhQueries;
static uint32_t pdhNextId = 1;
static const size_t kMaxPdhQueries = 16, kMaxPdhCounters = 64;

static napi_value PdhOpen(napi_env env, napi_callback_info info) {
  Args a(env, info);
  std::vector<napi_value> paths;
  if (a.argc < 1 || !getArray(env, a.argv[0], paths, kMaxPdhCounters)) return throwError(env, "pdhOpen(paths: string[])");
  if (pdhQueries.size() >= kMaxPdhQueries) return throwError(env, "pdhOpen: too many open PDH queries (16)");
  PdhQuery q;
  PDH_STATUS st = PdhOpenQueryW(nullptr, 0, &q.query);
  if (st != ERROR_SUCCESS) return throwError(env, "PdhOpenQuery: " + winError(st));
  for (napi_value p : paths) {
    std::string path;
    PDH_HCOUNTER c = nullptr;
    if (getString(env, p, path) && PdhAddEnglishCounterW(q.query, widen(path).c_str(), 0, &c) != ERROR_SUCCESS)
      c = nullptr;  // unknown counter: always null
    q.counters.push_back(c);
  }
  PdhCollectQueryData(q.query);  // first sample for rate counters
  uint32_t id = pdhNextId++;
  pdhQueries[id] = q;
  return number(env, id);
}

static napi_value PdhSample(napi_env env, napi_callback_info info) {
  Args a(env, info);
  double id = 0;
  auto it = a.argc > 0 && getNumber(env, a.argv[0], id) ? pdhQueries.find((uint32_t)id) : pdhQueries.end();
  if (it == pdhQueries.end()) return throwError(env, "pdhSample: unknown query");
  PdhCollectQueryData(it->second.query);
  const auto& cs = it->second.counters;
  napi_value arr;
  N.napi_create_array_with_length(env, cs.size(), &arr);
  for (size_t i = 0; i < cs.size(); i++) {
    PDH_FMT_COUNTERVALUE v;
    bool ok = cs[i] && PdhGetFormattedCounterValue(cs[i], PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, nullptr, &v) ==
                           ERROR_SUCCESS && (v.CStatus == PDH_CSTATUS_VALID_DATA || v.CStatus == PDH_CSTATUS_NEW_DATA);
    N.napi_set_element(env, arr, (uint32_t)i, ok ? number(env, v.doubleValue) : nullValue(env));
  }
  return arr;
}

static napi_value PdhClose(napi_env env, napi_callback_info info) {
  Args a(env, info);
  double id = 0;
  if (a.argc > 0 && getNumber(env, a.argv[0], id)) {
    auto it = pdhQueries.find((uint32_t)id);
    if (it != pdhQueries.end()) {
      PdhCloseQuery(it->second.query);
      pdhQueries.erase(it);
    }
  }
  return nullptr;
}

// ---------------------------------------------------------------------------------------------------------------
// ETW: one real-time session per process, named tcc-win-<pid>

static const wchar_t kSessionPrefix[] = L"tcc-win-";
static const GUID kEventTraceGuid = {0x68fdd900, 0x4a3e, 0x11d1, {0x84, 0xf4, 0x00, 0x00, 0xf8, 0x04, 0x64, 0xe3}};
static const size_t kMaxCountKeys = 256;

struct EtwEvent {
  GUID provider;
  uint16_t id;
  uint8_t opcode;
  uint8_t level;
  uint32_t pid;
  uint32_t tid;
  int64_t time;  // FILETIME
};

struct CountKey {
  GUID provider;
  uint16_t id;
  bool operator<(const CountKey& o) const {
    int c = memcmp(&provider, &o.provider, sizeof(GUID));
    return c != 0 ? c < 0 : id < o.id;
  }
};

struct Etw {
  std::mutex mu;
  std::deque<EtwEvent> ring;
  size_t capacity = 8192;
  uint64_t dropped = 0;       // since the last drain
  uint64_t total = 0;         // since start
  uint64_t otherCounts = 0;   // events past kMaxCountKeys distinct (provider, id) in this window
  std::map<CountKey, uint64_t> counts;
  std::atomic<bool> pending{false};
  std::atomic<bool> running{false};
  ULONG processStatus = ERROR_SUCCESS;

  std::wstring name;
  TRACEHANDLE session = 0;
  TRACEHANDLE trace = kInvalidTrace;
  std::thread consumer;
  napi_threadsafe_function signal = nullptr;
};
static Etw* etw = nullptr;

static std::vector<char> sessionProperties(const std::wstring& name) {
  std::vector<char> buf(sizeof(EVENT_TRACE_PROPERTIES) + (name.size() + 1) * sizeof(wchar_t) + 1024, 0);
  auto* p = reinterpret_cast<EVENT_TRACE_PROPERTIES*>(buf.data());
  p->Wnode.BufferSize = (ULONG)buf.size();
  p->Wnode.Flags = WNODE_FLAG_TRACED_GUID;
  p->Wnode.ClientContext = 1;  // QPC; the consumer gets FILETIMEs either way
  p->LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
  p->BufferSize = 64;  // KB
  p->MinimumBuffers = 4;
  p->MaximumBuffers = 16;
  p->FlushTimer = 1;  // s
  p->LoggerNameOffset = sizeof(EVENT_TRACE_PROPERTIES);
  return buf;
}

static ULONG stopSession(TRACEHANDLE handle, const std::wstring& name) {
  auto props = sessionProperties(name);
  return ControlTraceW(handle, handle ? nullptr : name.c_str(),
                       reinterpret_cast<EVENT_TRACE_PROPERTIES*>(props.data()), EVENT_TRACE_CONTROL_STOP);
}

// sessions a crashed process of ours left behind keep running (and count against the system's 64)
static int stopStaleSessions() {
  const ULONG max = 64;
  std::vector<std::vector<char>> bufs(max);
  EVENT_TRACE_PROPERTIES* ptrs[max];
  for (ULONG i = 0; i < max; i++) {
    bufs[i].assign(sizeof(EVENT_TRACE_PROPERTIES) + 2 * 1024 * sizeof(wchar_t), 0);
    ptrs[i] = reinterpret_cast<EVENT_TRACE_PROPERTIES*>(bufs[i].data());
    ptrs[i]->Wnode.BufferSize = (ULONG)bufs[i].size();
    ptrs[i]->LoggerNameOffset = sizeof(EVENT_TRACE_PROPERTIES);
    ptrs[i]->LogFileNameOffset = sizeof(EVENT_TRACE_PROPERTIES) + 1024 * sizeof(wchar_t);
  }
  ULONG count = 0;
  if (QueryAllTracesW(ptrs, max, &count) != ERROR_SUCCESS) return 0;
  int stopped = 0;
  const size_t prefixLen = wcslen(kSessionPrefix);
  for (ULONG i = 0; i < count; i++) {
    const wchar_t* name = reinterpret_cast<const wchar_t*>(bufs[i].data() + ptrs[i]->LoggerNameOffset);
    if (wcsncmp(name, kSessionPrefix, prefixLen) != 0) continue;
    DWORD pid = (DWORD)wcstoul(name + prefixLen, nullptr, 10);
    if (pid == GetCurrentProcessId()) continue;
    HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
    bool alive = h && WaitForSingleObject(h, 0) == WAIT_TIMEOUT;
    if (h) CloseHandle(h);
    if (!alive && stopSession(0, name) == ERROR_SUCCESS) stopped++;
  }
  return stopped;
}

static void WINAPI onEvent(PEVENT_RECORD r) {
  auto* e = static_cast<Etw*>(r->UserContext);
  const EVENT_HEADER& h = r->EventHeader;
  if (IsEqualGUID(h.ProviderId, kEventTraceGuid)) return;  // the session's own header event
  EtwEvent ev{h.ProviderId, h.EventDescriptor.Id, h.EventDescriptor.Opcode, h.EventDescriptor.Level,
              h.ProcessId, h.ThreadId, h.TimeStamp.QuadPart};
  {
    std::lock_guard<std::mutex> lock(e->mu);
    if (e->ring.size() >= e->capacity) {
      e->ring.pop_front();
      e->dropped++;
    }
    e->ring.push_back(ev);
    e->total++;
    CountKey k{ev.provider, ev.id};
    auto it = e->counts.find(k);
    if (it != e->counts.end()) it->second++;
    else if (e->counts.size() < kMaxCountKeys) e->counts.emplace(k, 1);
    else e->otherCounts++;
  }
  // one signal until JS drains; if JS is slow the ring just fills and drops the oldest
  if (e->signal && !e->pending.exchange(true))
    N.napi_call_threadsafe_function(e->signal, nullptr, napi_tsfn_nonblocking);
}

static void callSignal(napi_env env, napi_value cb, void*, void*) {
  if (!env || !cb) return;
  napi_value undefined;
  N.napi_get_undefined(env, &undefined);
  N.napi_call_function(env, undefined, cb, 0, nullptr, nullptr);
}

static void etwStop() {
  if (!etw) return;
  if (etw->session) stopSession(etw->session, etw->name);
  if (etw->trace != kInvalidTrace) CloseTrace(etw->trace);
  if (etw->consumer.joinable()) etw->consumer.join();
  if (etw->signal) N.napi_release_threadsafe_function(etw->signal, napi_tsfn_release);
  delete etw;
  etw = nullptr;
}

static bool parseGuid(const std::string& s, GUID& g) {
  unsigned long d1;
  unsigned int d2, d3, b[8];
  const char* p = s.c_str();
  if (*p == '{') p++;
  if (sscanf(p, "%8lx-%4x-%4x-%2x%2x-%2x%2x%2x%2x%2x%2x", &d1, &d2, &d3, &b[0], &b[1], &b[2], &b[3], &b[4], &b[5],
             &b[6], &b[7]) != 11)
    return false;
  g.Data1 = d1;
  g.Data2 = (unsigned short)d2;
  g.Data3 = (unsigned short)d3;
  for (int i = 0; i < 8; i++) g.Data4[i] = (unsigned char)b[i];
  return true;
}

static std::string guidString(const GUID& g) {
  char buf[40];
  snprintf(buf, sizeof buf, "%08lx-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x", (unsigned long)g.Data1, g.Data2,
           g.Data3, g.Data4[0], g.Data4[1], g.Data4[2], g.Data4[3], g.Data4[4], g.Data4[5], g.Data4[6], g.Data4[7]);
  return buf;
}

struct Provider {
  GUID guid;
  UCHAR level;
  ULONGLONG keywords;
};

// etwStart({ providers: [{ guid, level?, keywords? }], capacity?, pids?, onEvents? })
//   -> { session, staleStopped }; throws with the reason (access denied: not elevated) when it can't
static napi_value EtwStart(napi_env env, napi_callback_info info) {
  if (etw) return throwError(env, "etwStart: a session is already running (etwStop first)");
  Args a(env, info);
  napi_value opts = a.argc > 0 ? a.argv[0] : nullptr;
  if (typeOf(env, opts) != napi_object) return throwError(env, "etwStart(options)");

  std::vector<napi_value> list;
  if (!getArray(env, prop(env, opts, "providers"), list, 16) || list.empty())
    return throwError(env, "etwStart: providers must be a non-empty array (at most 16)");
  std::vector<Provider> providers;
  for (napi_value pv : list) {
    std::string guid, kw;
    double level = 4, kwNum = 0;  // 4 = informational
    Provider p{};
    if (!getString(env, prop(env, pv, "guid"), guid) || !parseGuid(guid, p.guid))
      return throwError(env, "etwStart: provider guid must look like 22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716");
    getNumber(env, prop(env, pv, "level"), level);
    p.level = (UCHAR)level;
    napi_value kwv = prop(env, pv, "keywords");
    if (getString(env, kwv, kw)) p.keywords = strtoull(kw.c_str(), nullptr, 0);
    else if (getNumber(env, kwv, kwNum)) p.keywords = (ULONGLONG)kwNum;
    else p.keywords = ~0ULL;
    providers.push_back(p);
  }
  std::vector<ULONG> pids;
  std::vector<napi_value> pidValues;
  if (getArray(env, prop(env, opts, "pids"), pidValues, MAX_EVENT_FILTER_PID_COUNT))
    for (napi_value v : pidValues) {
      double d;
      if (getNumber(env, v, d)) pids.push_back((ULONG)d);
    }
  double capacity = 8192;
  getNumber(env, prop(env, opts, "capacity"), capacity);
  if (capacity < 16) capacity = 16;
  if (capacity > 1 << 20) capacity = 1 << 20;

  std::unique_ptr<Etw> e(new Etw());
  e->capacity = (size_t)capacity;
  e->name = kSessionPrefix + std::to_wstring(GetCurrentProcessId());
  int stale = stopStaleSessions();

  auto props = sessionProperties(e->name);
  ULONG st = StartTraceW(&e->session, e->name.c_str(), reinterpret_cast<EVENT_TRACE_PROPERTIES*>(props.data()));
  if (st == ERROR_ALREADY_EXISTS) {  // ours, from a previous start that wasn't stopped
    stopSession(0, e->name);
    props = sessionProperties(e->name);
    st = StartTraceW(&e->session, e->name.c_str(), reinterpret_cast<EVENT_TRACE_PROPERTIES*>(props.data()));
  }
  if (st != ERROR_SUCCESS) {
    e->session = 0;
    std::string msg = "etwStart: StartTrace: " + winError(st);
    if (st == ERROR_ACCESS_DENIED)
      msg += elevated() ? "" : " - run elevated or add the user to the \"Performance Log Users\" group (then log in again)";
    return throwError(env, msg);
  }

  for (const Provider& p : providers) {
    ENABLE_TRACE_PARAMETERS params;
    memset(&params, 0, sizeof params);
    params.Version = ENABLE_TRACE_PARAMETERS_VERSION_2;
    EVENT_FILTER_DESCRIPTOR filter;
    if (!pids.empty()) {
      filter.Ptr = (ULONGLONG)(uintptr_t)pids.data();
      filter.Size = (ULONG)(pids.size() * sizeof(ULONG));
      filter.Type = EVENT_FILTER_TYPE_PID;
      params.EnableFilterDesc = &filter;
      params.FilterDescCount = 1;
    }
    st = EnableTraceEx2(e->session, &p.guid, EVENT_CONTROL_CODE_ENABLE_PROVIDER, p.level, p.keywords, 0, 0, &params);
    if (st != ERROR_SUCCESS) {
      stopSession(e->session, e->name);
      return throwError(env, "etwStart: EnableTraceEx2(" + guidString(p.guid) + "): " + winError(st));
    }
  }

  EVENT_TRACE_LOGFILEW lf;
  memset(&lf, 0, sizeof lf);
  lf.LoggerName = &e->name[0];
  lf.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
  lf.EventRecordCallback = onEvent;
  lf.Context = e.get();
  e->trace = OpenTraceW(&lf);
  if (e->trace == kInvalidTrace) {
    DWORD err = GetLastError();
    stopSession(e->session, e->name);
    return throwError(env, "etwStart: OpenTrace: " + winError(err));
  }

  napi_value cb = prop(env, opts, "onEvents");
  if (typeOf(env, cb) == napi_function) {
    napi_value resource = string(env, "tcc-win-telemetry:etw");
    if (N.napi_create_threadsafe_function(env, cb, nullptr, resource, 1, 1, nullptr, nullptr, nullptr, callSignal,
                                          &e->signal) == napi_ok)
      N.napi_unref_threadsafe_function(env, e->signal);  // never keeps the process alive
    else
      e->signal = nullptr;
  }

  Etw* raw = e.release();
  etw = raw;
  raw->running = true;
  raw->consumer = std::thread([raw] {
    raw->processStatus = ProcessTrace(&raw->trace, 1, nullptr, nullptr);
    raw->running = false;
  });

  Obj o(env);
  o.str("session", narrow(raw->name.c_str())).num("staleStopped", stale);
  return o.value;
}

// etwDrain() -> { events, counts, other, dropped, total, running, status } (events/counts/dropped since the last
// drain) or null when no session runs
static napi_value EtwDrain(napi_env env, napi_callback_info) {
  if (!etw) return nullValue(env);
  std::deque<EtwEvent> events;
  std::map<CountKey, uint64_t> counts;
  uint64_t dropped, total, other;
  {
    std::lock_guard<std::mutex> lock(etw->mu);
    events.swap(etw->ring);
    counts.swap(etw->counts);
    dropped = etw->dropped;
    other = etw->otherCounts;
    total = etw->total;
    etw->dropped = 0;
    etw->otherCounts = 0;
    etw->pending = false;
  }
  napi_value evs;
  N.napi_create_array_with_length(env, events.size(), &evs);
  uint32_t i = 0;
  for (const EtwEvent& ev : events) {
    Obj o(env);
    o.str("provider", guidString(ev.provider))
        .num("id", ev.id)
        .num("opcode", ev.opcode)
        .num("level", ev.level)
        .num("pid", ev.pid)
        .num("tid", ev.tid)
        .num("time", unixMs(ev.time));
    N.napi_set_element(env, evs, i++, o.value);
  }
  napi_value cs;
  N.napi_create_array_with_length(env, counts.size(), &cs);
  i = 0;
  for (const auto& kv : counts) {
    Obj o(env);
    o.str("provider", guidString(kv.first.provider)).num("id", kv.first.id).num("count", (double)kv.second);
    N.napi_set_element(env, cs, i++, o.value);
  }
  Obj o(env);
  o.set("events", evs)
      .set("counts", cs)
      .num("other", (double)other)
      .num("dropped", (double)dropped)
      .num("total", (double)total)
      .boolean("running", etw->running.load());
  if (!etw->running && etw->processStatus != ERROR_SUCCESS) o.str("status", winError(etw->processStatus));
  return o.value;
}

static napi_value EtwStop(napi_env env, napi_callback_info) {
  etwStop();
  return nullptr;
}

// ---------------------------------------------------------------------------------------------------------------

static void cleanup(void*) {
  etwStop();
  for (auto& kv : pdhQueries) PdhCloseQuery(kv.second.query);
  pdhQueries.clear();
}

static napi_value Info(napi_env env, napi_callback_info) {
  Obj o(env);
  o.num("napiVersion", NAPI_VERSION).num("pid", GetCurrentProcessId()).boolean("elevated", elevated());
#if defined(_MSC_VER)
  o.str("compiler", "msvc");
#else
  o.str("compiler", "gcc " __VERSION__);
#endif
  return o.value;
}

extern "C" __declspec(dllexport) int32_t node_api_module_get_api_version_v1(void) { return NAPI_VERSION; }

extern "C" __declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  std::string missing;
  if (!resolveApi(missing)) {
    if (N.napi_throw_error) N.napi_throw_error(env, nullptr, ("win-telemetry: the host doesn't export " + missing).c_str());
    return nullptr;
  }
  struct {
    const char* name;
    napi_callback fn;
  } fns[] = {{"info", Info},           {"processInfo", ProcessInfo}, {"jobInfo", JobInfo},
             {"systemInfo", SystemInfo}, {"isElevated", IsElevated},   {"pdhOpen", PdhOpen},
             {"pdhSample", PdhSample},   {"pdhClose", PdhClose},       {"etwStart", EtwStart},
             {"etwDrain", EtwDrain},     {"etwStop", EtwStop}};
  for (const auto& f : fns) {
    napi_value fn;
    N.napi_create_function(env, f.name, NAPI_AUTO_LENGTH, f.fn, nullptr, &fn);
    N.napi_set_named_property(env, exports, f.name, fn);
  }
  N.napi_add_env_cleanup_hook(env, cleanup, nullptr);
  return exports;
}
