// Options page: collector settings and the list of opted-in live sites.
// Permission prompts are shown from here (a full tab), where they can't be
// lost the way a popup closing mid-prompt can.

/** @param {string} id */
const $ = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** Same patterns as optional_host_permissions in manifest.json. */
const ALL_SITES = ["http://*/*", "https://*/*"];

/** @param {string} raw */
function originPattern(raw) {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) URLs");
  return `${u.protocol}//${u.hostname}/*`;
}

async function render() {
  const st = await chrome.runtime.sendMessage({ type: "status" });
  $("url").value = st.settings.collectorUrl;
  $("token").value = st.settings.token;
  $("label").value = st.settings.label;
  $("enabled").checked = st.settings.uploadEnabled;
  $("install").textContent = `Install ID: ${st.installId}`;
  $("all-sites").checked = await chrome.permissions.contains({ origins: ALL_SITES });

  const table = $("sites");
  table.replaceChildren(
    ...(/** @type {string[]} */ (st.sites)).map((origin) => {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = origin;
      const act = document.createElement("td");
      const btn = document.createElement("button");
      btn.textContent = "Remove";
      btn.onclick = async () => {
        await chrome.permissions.remove({ origins: [origin] });
        render();
      };
      act.append(btn);
      tr.append(td, act);
      return tr;
    }),
  );
  if (st.sites.length === 0) table.textContent = "No live sites enabled.";
}

$("save").addEventListener("click", async () => {
  const collectorUrl = $("url").value.trim();
  try {
    if (collectorUrl) {
      // The service worker needs host permission for the collector, or its
      // POST is a cross-origin request subject to CORS.
      const granted = await chrome.permissions.request({ origins: [originPattern(collectorUrl)] });
      if (!granted) throw new Error("permission for the collector host was refused");
    }
    await chrome.storage.local.set({
      settings: { collectorUrl, token: $("token").value.trim(), label: $("label").value.trim(), uploadEnabled: $("enabled").checked },
    });
    $("msg").textContent = "Saved.";
  } catch (err) {
    $("msg").textContent = `Not saved: ${/** @type {Error} */ (err).message}`;
  }
  render();
});

$("test").addEventListener("click", async () => {
  $("msg").textContent = "Testing…";
  // the test uses the saved settings, not what's in the form
  const st = await chrome.runtime.sendMessage({ type: "status" });
  const unsaved = st.settings.collectorUrl !== $("url").value.trim() || st.settings.token !== $("token").value.trim() || st.settings.uploadEnabled !== $("enabled").checked;
  const r = await chrome.runtime.sendMessage({ type: "test" });
  $("msg").textContent = !r.ok
    ? `Failed: ${r.error}`
    : "Collector reachable, token accepted." +
      (unsaved ? " The form has unsaved changes: Save to use them." : "") +
      (st.settings.uploadEnabled ? "" : " But streaming is off: tick “Stream events to the collector” and Save, or nothing is sent.");
});

$("all-sites").addEventListener("change", async () => {
  // The background listens for permissions.onAdded/onRemoved and re-registers the content scripts.
  try {
    if ($("all-sites").checked) {
      const granted = await chrome.permissions.request({ origins: ALL_SITES });
      $("msg").textContent = granted ? "Collecting on all sites. Reload open tabs to start." : "Permission refused.";
    } else {
      await chrome.permissions.remove({ origins: ALL_SITES });
      $("msg").textContent = "All-sites collection off. Sites added one by one stay enabled.";
    }
  } catch (err) {
    $("msg").textContent = `Failed: ${/** @type {Error} */ (err).message}`;
  }
  render();
});

$("add-site").addEventListener("click", async () => {
  try {
    const pattern = originPattern($("new-site").value.trim());
    if (await chrome.permissions.request({ origins: [pattern] })) $("new-site").value = "";
  } catch (err) {
    $("msg").textContent = `Invalid site: ${/** @type {Error} */ (err).message}`;
  }
  render();
});

render();

export {};
