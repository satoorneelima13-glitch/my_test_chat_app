"use client";

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  HelpCircle,
  Menu,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

type Feedback = "positive" | "negative";

interface Message {
  role: "user" | "assistant";
  content: string;
  feedback?: Feedback;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

const models = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
];

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState(models[0].value);
  const [status, setStatus] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentConv = conversations.find((c) => c.id === currentConvId);
  const messages = currentConv?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const startNewChat = () => {
    const newId = Date.now().toString();
    setConversations((prev) => [
      ...prev,
      { id: newId, title: "New chat", messages: [] },
    ]);
    setCurrentConvId(newId);
    setInput("");
    setStatus("");
  };

  const requestAnswer = async (chatMessages: Message[]) => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatMessages, model: selectedModel }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch response");
    }

    const data = await response.json();
    return data.text as string;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || loading) return;

    let convId = currentConvId;
    let existingMessages = messages;

    if (!convId) {
      convId = Date.now().toString();
      existingMessages = [];
      setCurrentConvId(convId);
      setConversations((prev) => [
        ...prev,
        { id: convId!, title: "New chat", messages: [] },
      ]);
    }

    const userMessage: Message = { role: "user", content: prompt };
    const requestMessages = [...existingMessages, userMessage];

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, messages: requestMessages } : c
      )
    );
    setInput("");
    setLoading(true);
    setStatus("");

    try {
      const text = await requestAnswer(requestMessages);
      const assistantMessage: Message = { role: "assistant", content: text };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                title:
                  existingMessages.length === 0
                    ? prompt.substring(0, 30) + (prompt.length > 30 ? "..." : "")
                    : c.title,
                messages: [...requestMessages, assistantMessage],
              }
            : c
        )
      );
    } catch (error) {
      console.error("Error:", error);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: [
                  ...requestMessages,
                  {
                    role: "assistant",
                    content: "Sorry, I encountered an error. Please try again.",
                  },
                ],
              }
            : c
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setStatus(`${label} copied`);
  };

  const editPrompt = (text: string) => {
    setInput(text);
    setStatus("Prompt copied into the message box for editing");
  };

  const findPromptForResponse = (messageIndex: number) => {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") return messages[index].content;
    }
    return "";
  };

  const saveFeedback = async (
    messageIndex: number,
    feedback: Feedback
  ) => {
    if (!currentConvId) return;
    const responseText = messages[messageIndex].content;
    const prompt = findPromptForResponse(messageIndex);
    if (!prompt) return;

    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, response: responseText, feedback }),
    });

    if (!response.ok) {
      setStatus("Feedback could not be saved");
      return;
    }

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === currentConvId
          ? {
              ...conversation,
              messages: conversation.messages.map((message, index) =>
                index === messageIndex ? { ...message, feedback } : message
              ),
            }
          : conversation
      )
    );
    setStatus(
      feedback === "positive"
        ? "Thumbs-up feedback saved to CSV"
        : "Thumbs-down feedback saved to CSV"
    );
  };

  const regenerateResponse = async (messageIndex: number) => {
    if (!currentConvId || loading) return;
    const promptIndex = [...messages]
      .slice(0, messageIndex)
      .map((message) => message.role)
      .lastIndexOf("user");
    if (promptIndex < 0) return;

    const requestMessages = messages.slice(0, promptIndex + 1);
    setLoading(true);
    setStatus("Regenerating response...");

    try {
      const text = await requestAnswer(requestMessages);
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === currentConvId
            ? {
                ...conversation,
                messages: conversation.messages.map((message, index) =>
                  index === messageIndex
                    ? { role: "assistant", content: text }
                    : message
                ),
              }
            : conversation
        )
      );
      setStatus("Response regenerated");
    } catch (error) {
      console.error("Regeneration error:", error);
      setStatus("Response could not be regenerated");
    } finally {
      setLoading(false);
    }
  };

  const suggestedPrompts = [
    "Explain quantum computing",
    "Write a Python function",
    "Plan a trip to Japan",
    "Summarize a topic",
  ];

  return (
    <div className="flex h-screen bg-gradient-to-br from-blue-100 via-blue-50 to-white">
      <div
        className={`transition-all duration-300 flex flex-col bg-white border-r border-gray-200 ${
          sidebarOpen ? "w-64" : "w-0"
        } overflow-hidden`}
      >
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors font-medium"
          >
            <Plus size={18} />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setCurrentConvId(conv.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                  currentConvId === conv.id
                    ? "bg-gray-200 text-gray-900 font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} />
                  <span className="truncate">{conv.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors">
            <HelpCircle size={18} />
            Help & FAQ
          </button>
          <button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors">
            <Settings size={18} />
            Settings
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="border-b border-gray-200 bg-white bg-opacity-80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Toggle sidebar"
              >
                <Menu size={20} className="text-gray-700" />
              </button>
              <h1 className="text-2xl font-semibold text-gray-900 whitespace-nowrap">
                My Gemini App
              </h1>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <span className="hidden sm:inline">Model</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={loading}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Select Gemini model"
              >
                {models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto w-full px-4 py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                <h2 className="text-3xl font-semibold text-gray-900 mb-2">
                  Hello there
                </h2>
                <p className="text-gray-600 mb-8">How can I help you today?</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      className="p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-left transition-colors"
                    >
                      <p className="text-gray-900 text-sm font-medium">
                        {prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-4 py-6 animate-in fade-in ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                    🤖
                  </div>
                )}
                <div
                  className={`max-w-2xl ${
                    msg.role === "user" ? "text-right" : "text-left"
                  }`}
                >
                  <p className="text-gray-900 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>
                  <div
                    className={`mt-3 flex items-center gap-1 text-gray-500 ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <>
                        <button
                          onClick={() => copyText(msg.content, "Prompt")}
                          className="p-1.5 rounded hover:bg-white/70"
                          title="Copy prompt"
                          aria-label="Copy prompt"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => editPrompt(msg.content)}
                          className="p-1.5 rounded hover:bg-white/70"
                          title="Edit prompt"
                          aria-label="Edit prompt"
                        >
                          <Pencil size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => saveFeedback(idx, "positive")}
                          className={`p-1.5 rounded hover:bg-white/70 ${
                            msg.feedback === "positive" ? "text-green-600" : ""
                          }`}
                          title="Helpful response"
                          aria-label="Thumbs up"
                        >
                          <ThumbsUp size={16} />
                        </button>
                        <button
                          onClick={() => saveFeedback(idx, "negative")}
                          className={`p-1.5 rounded hover:bg-white/70 ${
                            msg.feedback === "negative" ? "text-red-600" : ""
                          }`}
                          title="Not helpful"
                          aria-label="Thumbs down"
                        >
                          <ThumbsDown size={16} />
                        </button>
                        <button
                          onClick={() => regenerateResponse(idx)}
                          disabled={loading}
                          className="p-1.5 rounded hover:bg-white/70 disabled:opacity-40"
                          title="Regenerate response"
                          aria-label="Regenerate response"
                        >
                          <RefreshCw size={16} />
                        </button>
                        <button
                          onClick={() => copyText(msg.content, "Response")}
                          className="p-1.5 rounded hover:bg-white/70"
                          title="Copy response"
                          aria-label="Copy response"
                        >
                          <Copy size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-semibold text-lg">
                    👤
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-4 py-6 animate-in fade-in">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                  🤖
                </div>
                <div className="flex items-center gap-2">
                  {[0, 0.1, 0.2].map((delay) => (
                    <div
                      key={delay}
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="bg-white bg-opacity-80 backdrop-blur-sm border-t border-gray-200 py-4">
          <div className="max-w-4xl mx-auto px-4">
            {status && (
              <p className="mb-2 text-center text-sm text-gray-600" role="status">
                {status}
              </p>
            )}
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message Gemini"
                disabled={loading}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500 disabled:bg-gray-50 disabled:cursor-not-allowed transition-all bg-white text-gray-900"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-6 py-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
