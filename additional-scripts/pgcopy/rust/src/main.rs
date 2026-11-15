use anyhow::{Context, Result};
use futures_util::{pin_mut, TryStreamExt};
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use std::time::Instant;
use tokio::{
    fs::{self, File},
    io::{AsyncWriteExt, BufWriter},
    task::JoinSet,
};

// One output file per entry. Adjust table and column names to match your schema.
const EXPORTS: &[(&str, &str)] = &[
    ("categorias", "select * from categorias"),
    ("produtos", "select * from produtos"),
    ("auditorias", "select * from auditorias"),
    ("produtos_por_auditoria", "select * from produtos_por_auditoria"),
    ("detalhamentos_auditoria", "select * from detalhamentos_auditoria"),
    // safe columns only: no email, no senha
    ("usuarios", "select id, nome, permissoes, ativo from usuarios"),
];

#[tokio::main]
async fn main() -> Result<()> {
    let url = std::env::var("DATABASE_URL").context("set the DATABASE_URL environment variable")?;

    // Supabase requires TLS. Its certificate isn't in the Windows store by default,
    // so verification is skipped here, same as rejectUnauthorized: false in your Node app.
    // For proper verification, download the CA from Project Settings -> Database.
    let tls = MakeTlsConnector::new(
        TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()?,
    );

    fs::create_dir_all("export").await?;
    let inicio = Instant::now();

    let mut tarefas = JoinSet::new();
    for &(nome, query) in EXPORTS {
        let url = url.clone();
        let tls = tls.clone();
        tarefas.spawn(async move { (nome, exportar(&url, tls, nome, query).await) });
    }

    let mut falhou = false;
    while let Some(res) = tarefas.join_next().await {
        match res? {
            (nome, Ok((bytes, dur))) => println!(
                "{nome:<26} {:>10.2} MB  {:>6.1}s",
                bytes as f64 / 1_048_576.0,
                dur
            ),
            (nome, Err(e)) => {
                falhou = true;
                eprintln!("{nome:<26} ERRO: {e:#}");
            }
        }
    }

    println!("total: {:.1}s", inicio.elapsed().as_secs_f64());
    if falhou {
        std::process::exit(1);
    }
    Ok(())
}

async fn exportar(url: &str, tls: MakeTlsConnector, nome: &str, query: &str) -> Result<(u64, f64)> {
    let inicio = Instant::now();

    let (client, conn) = tokio_postgres::connect(url, tls)
        .await
        .context("conectar")?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            eprintln!("conexão encerrada com erro: {e}");
        }
    });

    let sql = format!("COPY ({query}) TO STDOUT WITH (FORMAT csv, HEADER)");
    let stream = client.copy_out(&sql).await.context("iniciar COPY")?;
    pin_mut!(stream);

    let arquivo = File::create(format!("export/{nome}.csv")).await?;
    let mut out = BufWriter::with_capacity(1 << 20, arquivo);

    let mut bytes = 0u64;
    while let Some(chunk) = stream.try_next().await? {
        bytes += chunk.len() as u64;
        out.write_all(&chunk).await?;
    }
    out.flush().await?;

    Ok((bytes, inicio.elapsed().as_secs_f64()))
}
