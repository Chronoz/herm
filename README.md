# Angelia - A Modern TUI for Hermes Agent

Angelia is a beautiful terminal user interface (TUI) for the Hermes Agent, built with OpenTUI and React. It provides a modern chat interface with an integrated avatar, tool status display, and streaming responses via the Hermes API server.

![Angelia TUI](docs/screenshot.png)

## Features

- 🎨 **Beautiful TUI** - Modern terminal interface built with OpenTUI React
- 🤖 **ASCII Art Avatar** - 48-character wide ASCII art avatar of Nous
- 🔧 **Tool Status Display** - See which tools are active
- 💬 **Real-time Streaming** - Streaming responses with typing indicators
- 📝 **Persistent Sessions** - Conversations are saved via session IDs
- 🎯 **OpenAI-Compatible** - Uses the standard Hermes API server

## Architecture

```
┌─────────────┐      HTTP/SSE      ┌────────────────┐     ┌─────────────┐
│ Angelia TUI │ ←─────────────────→ │   API Server   │ ←──→ │   Hermes    │
│  (React)    │    localhost:8642   │   (Platform)   │     │   Agent     │
└─────────────┘                     └────────────────┘     └─────────────┘
```

## Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- [Hermes Agent](https://github.com/BionicLabsHQ/hermes-agent) - The AI agent backend
- Terminal with 256 color support

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/angelia.git
   cd angelia
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

## Usage

1. Start the Hermes gateway in a terminal:
   ```bash
   hermes gateway run
   ```

   The API server will run on port 8642. You should see something like:
   ```
   ✓ api_server connected (http://127.0.0.1:8642)
   ```

   Note: The API server is enabled via the config file. If you don't see it start, check the [Configuration](#configuration) section.

2. In another terminal, run Angelia:
   ```bash
   bun run src/index.tsx
   ```

Angelia will automatically connect to the Hermes API server at `http://localhost:8642`.

## Configuration

### API Server URL

To connect to a remote Hermes API server, modify the URL in `src/index.tsx`:

```typescript
const client = new HermesApiClient({
  baseUrl: "http://your-server:8642/v1",  // Change this
  apiKey: "your-api-key",  // Optional, if API key is configured
});
```

### Hermes API Server Configuration

To enable the API server permanently, add this to your `~/.hermes/config.yaml`:

```yaml
gateway:
  platforms:
    api_server:
      enabled: true
      host: "127.0.0.1"  # Or "0.0.0.0" to listen on all interfaces
      port: 8642
      api_key: ""  # Leave empty for no auth, or set a secret key
      cors_origins: []  # Add ["*"] for browser-based clients
```

Once configured, you don't need environment variables - just run `hermes gateway run`.

Alternatively, you can use environment variables (which override the config file):

```bash
export API_SERVER_ENABLED=true
export API_SERVER_HOST=0.0.0.0
export API_SERVER_PORT=8642
export API_SERVER_API_KEY=your-secret-key
```

## Development

### Project Structure

```
angelia/
├── src/
│   ├── index.tsx               # Main application component
│   └── hermes-api-client.ts    # Hermes API client
├── docs/
│   ├── nous-girl-ascii-*.txt   # ASCII art files
│   └── *.md                    # Documentation
└── package.json
```

### Building

To build a standalone executable:

```bash
bun build src/index.tsx --compile --outfile angelia
```

### Testing

Run the test suite:

```bash
bun test
```

## ASCII Art

Angelia includes multiple ASCII art versions of the Nous avatar:

- `docs/nous-girl-ascii-32w.txt` - Compact 32-character wide version
- `docs/nous-girl-ascii-48w.txt` - Main 48-character wide version (used in UI)
- `docs/nous-girl-ascii-64w.txt` - Detailed 64-character wide version

## Troubleshooting

### API Server Not Starting

If you don't see `✓ api_server connected` when starting the gateway:

1. **Check your config file has the API server enabled:**
   ```bash
   grep -A5 "api_server:" ~/.hermes/config.yaml
   ```
   
   Should show `enabled: true`. If not, add the configuration shown above.

2. **Check if port 8642 is already in use:**
   ```bash
   lsof -i :8642
   ```

3. **Try a different port in the config:**
   ```yaml
   gateway:
     platforms:
       api_server:
         enabled: true
         port: 8080  # Different port
   ```

### Connection Issues

1. **Verify API server is accessible:**
   ```bash
   curl http://localhost:8642/health
   ```
   Should return: `{"status":"ok","platform":"hermes-agent"}`

2. **Check gateway logs:**
   ```bash
   tail -f ~/.hermes/logs/gateway.log
   ```

3. **Test with a simple chat completion:**
   ```bash
   curl -X POST http://localhost:8642/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model": "hermes-agent", "messages": [{"role": "user", "content": "Hello"}]}'
   ```

### Session Persistence

Sessions are automatically persisted using the `X-Hermes-Session-Id` header. Each Angelia instance generates a unique session ID that allows conversation continuity even after restarting.

### Display Issues

- Ensure your terminal supports 256 colors
- Try resizing your terminal window (minimum 100 columns recommended)
- Check that you're using a monospace font

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Built with [OpenTUI](https://github.com/anomalyco/opentui) - The TUI framework
- Powered by [Hermes Agent](https://github.com/BionicLabsHQ/hermes-agent) - The AI agent
- ASCII art created with [ascii-image-converter](https://github.com/TheZoraiz/ascii-image-converter)