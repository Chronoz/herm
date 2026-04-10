import { EventEmitter } from "events";

export interface HermesApiConfig {
  baseUrl?: string;
  apiKey?: string;
  sessionId?: string;
  model?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: any[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class HermesApiClient extends EventEmitter {
  private baseUrl: string;
  private apiKey?: string;
  private sessionId: string;
  private model: string;
  private abortController?: AbortController;

  constructor(config: HermesApiConfig = {}) {
    super();
    this.baseUrl = config.baseUrl || "http://localhost:8642/v1";
    this.apiKey = config.apiKey;
    this.sessionId = config.sessionId || `angelia-${Date.now()}`;
    this.model = config.model || "hermes-agent";
  }

  async connect(): Promise<void> {
    // Test connection by calling /health with retry
    const maxRetries = 3;
    const retryDelay = 2000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl.replace("/v1", "")}/health`);
        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status}`);
        }
        const data = await response.json();
        if (data.status === "ok") {
          this.emit("connected", { sessionId: this.sessionId });
          return;
        }
      } catch (error: any) {
        if (attempt === maxRetries) {
          throw new Error(`Failed to connect to Hermes API at ${this.baseUrl}: ${error.message}`);
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  async sendMessage(content: string): Promise<void> {
    this.abortController = new AbortController();
    
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "X-Hermes-Session-Id": this.sessionId, // Enable session continuity
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content }],
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API request failed: ${error}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) {
        throw new Error("No response body");
      }

      // Emit typing indicator
      this.emit("typing", true);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              this.emit("typing", false);
              continue;
            }

            try {
              const event: StreamEvent = JSON.parse(data);
              
              // Handle content chunks
              if (event.choices?.[0]?.delta?.content) {
                this.emit("content", event.choices[0].delta.content);
              }

              // Handle tool calls
              if (event.choices?.[0]?.delta?.tool_calls) {
                this.emit("tool_call", event.choices[0].delta.tool_calls);
              }

              // Handle completion
              if (event.choices?.[0]?.finish_reason) {
                this.emit("done", {
                  reason: event.choices[0].finish_reason,
                  usage: event.usage,
                });
              }
            } catch (e) {
              // Ignore parse errors for malformed events
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.emit("aborted");
      } else {
        this.emit("error", error);
      }
      this.emit("typing", false);
    } finally {
      this.abortController = undefined;
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  disconnect(): void {
    this.abort();
    this.removeAllListeners();
  }
}