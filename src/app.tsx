import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState, useEffect, useRef } from "react";
import { HermesApiClient } from "./utils/hermes-api-client";
import { TabBar } from "./components/tabs/TabBar";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Chat } from "./tabs/Chat";
import { Context } from "./tabs/Context";
import type { Message } from "./components/chat/MessageItem";

export const App = () => {
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
        apiKey: process.env.HERMES_API_KEY,
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
        currentAssistantMessage.current += chunk;

        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage.role === "assistant" && isTyping) {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                content: currentAssistantMessage.current,
              },
            ];
          } else {
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
          currentAssistantMessage.current = "";
        }
      });

      client.on("done", (data) => {
        setIsTyping(false);
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
      await client.connect();
    } catch (err: any) {
      setMessages([
        {
          role: "system",
          content: `Failed to connect: ${err.message}`,
          timestamp: Date.now() / 1000,
        },
      ]);
    }
  };

  useEffect(() => {
    connectToHermes();
    return () => {
      if (clientRef.current) {
        clientRef.current.removeAllListeners();
      }
    };
  }, []);

  const sendMessage = () => {
    if (!input.trim()) return;

    const msg = input.trim();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: msg,
        timestamp: Date.now() / 1000,
      },
    ]);

    if (clientRef.current) {
      clientRef.current.sendMessage(msg);
    }

    setInput("");
  };

  // Handle keyboard events
  useKeyboard((key) => {
    // Allow arrow keys to pass through for tab navigation
    if (key.name === "left" || key.name === "right") {
      return;
    }
    
    if (key.name === "return") {
      sendMessage();
    } else if (key.ctrl && key.name === "c") {
      renderer.destroy();
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

  const tabs = [
    { name: "Chat", description: "Main chat interface" },
    { name: "Context", description: "Context and session info" },
  ];

  // Render content based on active tab
  const renderTabContent = () => {
    switch (activeTab) {
      case 0:
        return (
          <Chat
            messages={messages}
            isTyping={isTyping}
            input={input}
            hermesReady={hermesReady}
          />
        );
      case 1:
        return <Context description={tabs[activeTab].description} />;
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
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <box flexGrow={1} flexDirection="row">
        {renderTabContent()}
        <Sidebar activeTools={activeTools} memoryCount={memoryCount} />
      </box>
    </box>
  );
};
