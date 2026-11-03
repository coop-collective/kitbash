use std::{error::Error, time::Duration};
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let address = service::bind_address(std::env::var("PORT").ok().as_deref())?;
    let scratch = service::default_scratch()?;
    println!("ready scratchMemoryBacked={}", scratch.memory_backed);
    let listener = tokio::net::TcpListener::bind(address).await?;
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let (stop_sender, stop_receiver) = tokio::sync::oneshot::channel::<()>();
    let server = axum::serve(listener, service::router(scratch)).with_graceful_shutdown(async {
        let _ = stop_receiver.await;
    });
    let server = std::future::IntoFuture::into_future(server);
    tokio::pin!(server);
    tokio::select! {
        result = &mut server => { result?; return Ok(()); }
        result = tokio::signal::ctrl_c() => { result?; }
        _ = terminate.recv() => {}
    }
    let _ = stop_sender.send(());
    tokio::time::timeout(Duration::from_secs(10), &mut server).await??;
    Ok(())
}
