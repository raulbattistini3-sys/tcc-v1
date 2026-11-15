use anyhow::{bail, Context, Result};
use serde_json::{Map, Number, Value};
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::Instant,
};

fn main() -> Result<()> {
    let inicio = Instant::now();

    let mut arquivos: Vec<PathBuf> = fs::read_dir("export")
        .context("pasta export/ não encontrada")?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("csv")))
        .collect();
    arquivos.sort();

    if arquivos.is_empty() {
        bail!("nenhum arquivo .csv em export/");
    }

    let mut out = BufWriter::with_capacity(1 << 20, File::create("dados.json")?);
    out.write_all(b"{")?;

    for (i, caminho) in arquivos.iter().enumerate() {
        // the file name becomes the key: export/produtos.csv -> "produtos"
        let tabela = caminho
            .file_stem()
            .and_then(|s| s.to_str())
            .context("nome de arquivo inválido")?;

        if i > 0 {
            out.write_all(b",")?;
        }
        serde_json::to_writer(&mut out, tabela)?;
        out.write_all(b":[")?;

        let linhas = escrever_tabela(caminho, &mut out).with_context(|| format!("tabela {tabela}"))?;

        out.write_all(b"]")?;
        println!("{tabela:<26} {linhas:>9} linhas");
    }

    out.write_all(b"}")?;
    out.flush()?;

    let tamanho = fs::metadata("dados.json")?.len() as f64 / 1_048_576.0;
    println!("dados.json: {tamanho:.2} MB em {:.1}s", inicio.elapsed().as_secs_f64());
    Ok(())
}

fn escrever_tabela(caminho: &Path, out: &mut impl Write) -> Result<u64> {
    let mut leitor = csv::ReaderBuilder::new().has_headers(true).from_path(caminho)?;
    let cabecalho = leitor.headers()?.clone();

    let mut registro = csv::StringRecord::new();
    let mut n = 0u64;

    while leitor.read_record(&mut registro)? {
        if n > 0 {
            out.write_all(b",")?;
        }
        let mut obj = Map::with_capacity(cabecalho.len());
        for (coluna, valor) in cabecalho.iter().zip(registro.iter()) {
            obj.insert(coluna.to_owned(), inferir(valor));
        }
        serde_json::to_writer(&mut *out, &obj)?;
        n += 1;
    }
    Ok(n)
}

/// CSV loses types, so this rebuilds them the way json_agg would output them.
fn inferir(v: &str) -> Value {
    match v {
        "" => Value::Null,              // Postgres writes NULL as an empty field
        "t" => Value::Bool(true),       // Postgres booleans in CSV
        "f" => Value::Bool(false),
        _ if parece_inteiro(v) => match v.parse::<i64>() {
            Ok(i) => Value::Number(i.into()),
            Err(_) => Value::String(v.to_owned()), // too big for i64: keep exact as text
        },
        _ if parece_decimal(v) => v
            .parse::<f64>()
            .ok()
            .and_then(Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(v.to_owned())),
        _ => Value::String(v.to_owned()),
    }
}

fn digitos(v: &str) -> &str {
    v.strip_prefix('-').unwrap_or(v)
}

fn parece_inteiro(v: &str) -> bool {
    let d = digitos(v);
    !d.is_empty()
        && d.bytes().all(|b| b.is_ascii_digit())
        && !(d.len() > 1 && d.starts_with('0')) // codes like "007" stay as text
}

fn parece_decimal(v: &str) -> bool {
    let d = digitos(v);
    let Some((inteira, fracao)) = d.split_once('.') else { return false };
    !inteira.is_empty()
        && !fracao.is_empty()
        && inteira.bytes().all(|b| b.is_ascii_digit())
        && fracao.bytes().all(|b| b.is_ascii_digit())
        && !(inteira.len() > 1 && inteira.starts_with('0'))
}