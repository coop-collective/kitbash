use std::{error::Error, time::Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let host = std::env::var("HOST").ok();
    let port = std::env::var("PORT").ok();
    let address = service::bind_address(host.as_deref(), port.as_deref())?;
    let listener = tokio::net::TcpListener::bind(address).await?;

    // Register handlers before serving so setup failure cannot leave a running service.
    #[cfg(unix)]
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let (stop_sender, stop_receiver) = tokio::sync::oneshot::channel::<()>();
    let server = axum::serve(listener, service::router()).with_graceful_shutdown(async {
        let _ = stop_receiver.await;
    });
    let server = std::future::IntoFuture::into_future(server);
    tokio::pin!(server);
    let signal = async {
        #[cfg(unix)]
        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = terminate.recv() => Ok(()),
        }
        #[cfg(not(unix))]
        tokio::signal::ctrl_c().await
    };
    tokio::select! {
        result = &mut server => { result?; return Ok(()); }
        result = signal => { result?; }
    }
    let _ = stop_sender.send(());
    tokio::time::timeout(Duration::from_secs(10), &mut server).await??;
    Ok(())
}
