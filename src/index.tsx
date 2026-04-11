import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState, useEffect, useRef } from "react";
import { HermesApiClient } from "./hermes-api-client";
import { AnimatedAvatar } from "./animated-avatar";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

const App = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [currentModel] = useState("hermes-agent");
  const [activeTools] = useState(["web", "file"]);
  const [memoryCount] = useState(0);
  const [hermesReady, setHermesReady] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId] = useState(`herm-${Date.now()}`);
  const [activeTab, setActiveTab] = useState(0);

  const renderer = useRenderer();
  const clientRef = useRef<HermesApiClient | null>(null);
  const currentAssistantMessage = useRef<string>("");

  const connectToHermes = async () => {
    try {
      const client = new HermesApiClient({
        baseUrl: "http://localhost:8642/v1",
        apiKey: process.env.HERMES_API_KEY, // Optional API key
        sessionId: sessionId,
        model: currentModel,
      });

      // Set up event handlers
      client.on("connected", (data) => {
        setHermesReady(true);
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Connected to Hermes API. Session: ${data.sessionId}`,
            timestamp: Date.now() / 1000,
          },
        ]);
      });

      client.on("content", (chunk: string) => {
        // Accumulate streaming content
        currentAssistantMessage.current += chunk;

        // Update the last assistant message or create a new one
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage.role === "assistant" && isTyping) {
            // Update existing message
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                content: currentAssistantMessage.current,
              },
            ];
          } else {
            // Create new message
            return [
              ...prev,
              {
                role: "assistant",
                content: currentAssistantMessage.current,
                timestamp: Date.now() / 1000,
              },
            ];
          }
        });
      });

      client.on("typing", (typing: boolean) => {
        setIsTyping(typing);
        if (!typing) {
          // Reset for next message
          currentAssistantMessage.current = "";
        }
      });

      client.on("done", (data) => {
        setIsTyping(false);
        // Could show token usage here
        if (data.usage) {
          console.log("Token usage:", data.usage);
        }
      });

      client.on("error", (err) => {
        setIsTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Error: ${err.message}`,
            timestamp: Date.now() / 1000,
          },
        ]);
      });

      clientRef.current = client;

      // Connect
      await client.connect();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Failed to connect to Hermes API: ${err.message || err}`,
          timestamp: Date.now() / 1000,
        },
        {
          role: "system",
          content:
            "Make sure the gateway is running with: API_SERVER_ENABLED=true hermes gateway run",
          timestamp: Date.now() / 1000,
        },
      ]);
    }
  };

  useEffect(() => {
    connectToHermes();

    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  const sendMessage = () => {
    const msg = input.trim();
    if (!msg || !hermesReady) return;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: msg,
        timestamp: Date.now() / 1000,
      },
    ]);

    // Send message via WebSocket
    if (clientRef.current) {
      clientRef.current.sendMessage(msg);
    }

    setInput("");
  };

  // Handle keyboard events
  useKeyboard((key) => {
    if (key.name === "return") {
      sendMessage();
    } else if (key.ctrl && key.name === "c") {
      renderer.destroy(); // Proper exit
    } else if (key.name === "backspace") {
      setInput((prev) => prev.slice(0, -1));
    } else if (
      key.sequence &&
      key.sequence.length === 1 &&
      !key.ctrl &&
      !key.meta
    ) {
      setInput((prev) => prev + key.sequence);
    }
  });

  const allTools = ["web", "file", "terminal", "code", "vision", "browser"];

  const tabs = [
    { name: "Chat", description: "Main chat interface" },
    { name: "Context", description: "Context and session info" },
  ];

  // Render content based on active tab
  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // Chat tab
        return (
          <box
            flexGrow={1}
            padding={1}
            flexDirection="column"
            backgroundColor="black"
          >
            {messages.length === 0 ? (
              <box flexGrow={1} justifyContent="center" alignItems="center">
                <box flexDirection="column" alignItems="center">
                  <text>
                    <span fg="gray">Welcome to Herm</span>
                  </text>
                  <text>
                    <span fg="gray">Type your message below to start...</span>
                  </text>
                </box>
              </box>
            ) : (
              <scrollbox flexGrow={1} focused>
                <box flexDirection="column">
                  {messages.map((msg, index) => (
                    <box
                      key={index}
                      padding={1}
                      marginBottom={1}
                      backgroundColor={
                        msg.role === "user"
                          ? "#004488"
                          : msg.role === "assistant"
                            ? "#006644"
                            : "#444400"
                      }
                    >
                      <text>
                        <strong>
                          {msg.role === "user"
                            ? "You"
                            : msg.role === "assistant"
                              ? "Hermes"
                              : "System"}
                          :
                        </strong>
                        <span> {msg.content}</span>
                      </text>
                    </box>
                  ))}

                  {/* Typing indicator */}
                  {isTyping && (
                    <box padding={1} marginBottom={1} backgroundColor="#006644">
                      <text>
                        <strong>Hermes:</strong>
                        <span> </span>
                        <span fg="#90EE90">typing...</span>
                      </text>
                    </box>
                  )}
                </box>
              </scrollbox>
            )}

            {/* Input area */}
            <box
              height={3}
              border
              borderStyle="single"
              paddingLeft={1}
              marginTop={1}
            >
              <text>
                {">"} {input}_
              </text>
            </box>

            {/* Help text */}
            <text>
              <span fg="gray">
                Ctrl+C: Exit | Enter: Send |{" "}
                {hermesReady ? "Connected" : "Connecting..."}
              </span>
            </text>
          </box>
        );

      case 1: // Context tab
        return (
          <box flexGrow={1} padding={2}>
            <text>{tabs[activeTab].description}</text>
          </box>
        );

      default:
        return null;
    }
  };

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor="black"
    >
      {/* Tab Bar */}
      <box width="100%" flexDirection="column">
        <tab-select
          options={tabs}
          selectedIndex={activeTab}
          onChange={(index) => setActiveTab(index)}
          focused={true}
          tabWidth={15}
          height={1}
        />
      </box>

      {/* Main content */}
      <box flexGrow={1} flexDirection="row">
        {/* Tab content area */}
        {renderTabContent()}

        {/* Sidebar (right) - Always visible */}
        <box width={55} backgroundColor="#333333" flexDirection="column">
          {/* Avatar Box */}
          <box
            padding={1}
            marginBottom={1}
            borderStyle="single"
            border
            borderColor="#666666"
            flexDirection="column"
            height={26}
            overflow="hidden"
          >
            <AnimatedAvatar />
          </box>

          {/* Tools Section */}
          <box padding={1} flexDirection="column">
            <text>
              <strong>Tools</strong>
            </text>
            <text> </text>
            {allTools.map((tool) => (
              <text key={tool}>
                <span fg={activeTools.includes(tool) ? "green" : "gray"}>
                  {activeTools.includes(tool) ? "[x]" : "[ ]"} {tool}
                </span>
              </text>
            ))}

            <text> </text>
            <text> </text>
            <text>
              <strong>Memory</strong>
            </text>
            <text>
              <span fg="gray">{memoryCount} facts</span>
            </text>
          </box>
        </box>
      </box>
    </box>
  );
};

// Initialize and render
const main = async () => {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C ourselves
  });

  const root = createRoot(renderer);
  root.render(<App />);
};

main().catch(console.error);

export {};
