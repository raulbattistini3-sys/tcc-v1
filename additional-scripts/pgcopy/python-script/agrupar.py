"""Group the CSVs in export/ into a single dados.json, mirroring the shape of:

  select json_build_object('categorias', (select coalesce(json_agg(c), '[]') from categorias c), ...)

CSV loses column types, so each column's type is declared below so the output
matches what Postgres json_agg would emit (booleans, numbers, nulls, jsonb, timestamps).
Unquoted empty fields are treated as NULL (that's how COPY ... CSV writes NULL).
"""

import csv
import json
import re
import sys
from pathlib import Path

csv.field_size_limit(sys.maxsize)

# Column types: text (default), bool, num, json, ts (timestamp), tstz (timestamptz)
TABELAS = {
    "categorias": {"ativo": "bool"},
    "produtos": {
        "ativo": "bool",
        "valor_de_custo": "num",
        "icms": "num",
        "valor_de_venda": "num",
        "data_de_cadastro": "ts",
        "quantidade_em_estoque": "num",
    },
    "auditorias": {
        "data_de_audicao": "ts",
        "deleted_at": "tstz",
        "criada_em": "tstz",
        "vinculada_em": "tstz",
    },
    "produtos_por_auditoria": {},
    "detalhamentos_auditoria": {
        "valor_anterior": "num",
        "valor_atual": "num",
        "deleted_at": "tstz",
        "alteracoes": "json",
    },
    "usuarios": {"ativo": "bool"},
}

TZ = re.compile(r"([+-]\d{2})(:?(\d{2}))?$")


def valor(v: str, tipo: str) -> str:
    if v == "":
        return "null"
    if tipo == "bool":
        return "true" if v == "t" else "false"
    if tipo == "num":
        return v  # keep exact numeric text, e.g. 4080.00
    if tipo == "json":
        return json.dumps(json.loads(v), ensure_ascii=False, separators=(", ", ": "))
    if tipo in ("ts", "tstz"):
        v = v.replace(" ", "T", 1)
        if tipo == "tstz":
            v = TZ.sub(lambda m: f"{m.group(1)}:{m.group(3) or '00'}", v)
    return json.dumps(v, ensure_ascii=False)


def main() -> None:
    base = Path(__file__).parent
    with open(base / "dados.json", "w", encoding="utf-8", newline="") as out:
        out.write("{")
        for i, (tabela, tipos) in enumerate(TABELAS.items()):
            out.write(("" if i == 0 else ", ") + f'"{tabela}" : [')
            with open(base / "export" / f"{tabela}.csv", encoding="utf-8", newline="") as f:
                leitor = csv.reader(f)
                colunas = next(leitor)
                chaves = [json.dumps(c) + ":" for c in colunas]
                col_tipos = [tipos.get(c, "text") for c in colunas]
                n = 0
                for linha in leitor:
                    campos = ",".join(
                        k + valor(v, t) for k, v, t in zip(chaves, linha, col_tipos)
                    )
                    out.write(("" if n == 0 else ", \n ") + "{" + campos + "}")
                    n += 1
            out.write("]")
            print(f"{tabela:<26} {n} linhas")
        out.write("}\n")


if __name__ == "__main__":
    main()
