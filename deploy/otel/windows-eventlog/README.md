# Windows Event Log to Cortex

This runs the OpenTelemetry Collector **contrib** build as a Windows service. It reads the System and Application channels, plus a narrow Security query (event IDs 4625 and 4740), and sends OTLP/HTTP logs to Cortex. The plain collector build does not include the `windowseventlog` receiver.

Cortex stores a map log body as `[kvlist len=N]`, so `transform/body` flattens each event to `[<event id>] <provider>: <message>` and keeps the channel, event ID, and provider as attributes. Cortex derives severity from the numeric OTLP severity only, which the receiver sets from the event level.

## Install

1. Download `otelcol-contrib_<version>_windows_amd64.tar.gz` from the OpenTelemetry Collector releases, verify its `.sha256`, and extract it to `C:\otelcol`.
2. Copy `config.yaml` to `C:\otelcol\config.yaml`.
3. In an admin PowerShell, create the service and give it its own environment (not machine-wide):

   ```powershell
   New-Service -Name otelcol -BinaryPathName '"C:\otelcol\otelcol-contrib.exe" --config "C:\otelcol\config.yaml"' -StartupType Automatic
   Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\otelcol" -Name Environment -Type MultiString -Value @(
     "CORTEX_OTLP_ENDPOINT=http://<cortex-host>:3100",
     "CORTEX_OTLP_HOST_NAME=$($env:COMPUTERNAME)",
     "CORTEX_OTLP_AUTH_HEADER=Bearer <CORTEX_TOKEN>"
   )
   Start-Service otelcol
   ```

   The token is the server's machine-ingest `CORTEX_TOKEN`, not `CORTEX_API_TOKEN`. Never commit it. Restart the service after changing the environment.

4. Confirm rows arrive: search Cortex for `app_name=windows-eventlog` and `hostname=<CORTEX_OTLP_HOST_NAME>`. Cortex logs `OTLP /v1/logs unauthorized` with the sender address when the token is wrong.

The exporter sets `compression: none`, matching the host metrics producer. The collector starts reading at the end of each channel and remembers its position under `C:\ProgramData\otelcol\storage`.

## Known gap

Events whose provider message file cannot be resolved arrive with an empty message (`[4] PHP-8.4.13: `). The details are in another field of the parsed event; fall back to it in `transform/body` once a real event body has been inspected with the `debug` exporter.

## Stop or roll back

`Stop-Service otelcol; sc.exe delete otelcol`. This leaves `C:\otelcol` and the stored read position in place. Cortex does not delete logs already received.
