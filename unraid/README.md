# Cortex on Unraid

`cortex.xml` is the Unraid Community Apps template for the `ghcr.io/dinglebear-ai/cortex` image. `cortex-icon.png` is its 512×512 icon.

## Install (manual, before CA listing)

Save the template to the flash drive, then add the container from **Docker → Add Container → Template**:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-cortex.xml \
  https://raw.githubusercontent.com/BigWebstas/cortex/unraid/unraid/cortex.xml
```

Set both tokens before first start (`openssl rand -hex 32`):

- `CORTEX_TOKEN` — MCP and machine ingest.
- `CORTEX_API_TOKEN` — REST API. Use a different value.

The template runs the container as `99:100` (`nobody:users`) so appdata is writable. Syslog listens on 1514 (UDP/TCP); point Unraid's **Settings → Syslog Server** remote host at `<tower-ip>:1514`.

## Publish to Community Apps

CA indexes a template from a maintainer's GitHub repo, not from this one directly.

1. Create a public repo for templates (e.g. `dinglebear-ai/unraid-templates`) containing `cortex.xml` at its root and the icon (update `<Icon>`/`<TemplateURL>` to match, or keep the URLs pointing here).
2. Post a support thread for Cortex in the Unraid forum (**Docker Containers** section) and use its URL for `<Support>` if you want it instead of GitHub issues.
3. Request inclusion by following the [CA application process](https://forums.unraid.net/topic/38582-plug-in-community-applications/) (post in the *Community Applications* thread / "Application Submission" instructions) with the template repo link.
4. After approval, template edits to `main` are picked up automatically.

## Keeping the template current

The template uses `:latest`. Pin `<Repository>` to a version tag only if you want CA users on a fixed release.
