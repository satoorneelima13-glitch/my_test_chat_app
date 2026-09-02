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
  X,
} from "lucide-react";
import { DEFAULT_MODEL, MODELS } from "../lib/models";
import {
  DEFAULT_SETTINGS_FORM,
  parseSettingsForm,
  SettingsFormState,
} from "../lib/settingsForm";
import { RawGenerationSettings } from "../lib/generationSettings";
import { drainStreamLines, StreamProtocolError } from "../lib/streamProtocol";
import { TEST_SYNTHETIC_STREAM_MODEL } from "../lib/streamTestFixture";

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

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

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(DEFAULT_SETTINGS_FORM);
  const [streamingEnabled, setStreamingEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const requestAnswer = async (
    chatMessages: Message[],
    settings: RawGenerationSettings,
    signal: AbortSignal
  ) => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatMessages,
        model: selectedModel,
        settings,
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch response");
    }

    const data = await response.json();
    return data.text as string;
  };

  // Reads the /api/chat NDJSON stream, calling onChunk with the
  // accumulated-so-far text after every chunk event. Resolves once a "done"
  // event arrives; throws StreamProtocolError (carrying whatever text had
  // accumulated) on a malformed event or a connection that ends without
  // ever sending "done", so the caller can keep partial output instead of
  // discarding it.
  const requestAnswerStreaming = async (
    chatMessages: Message[],
    settings: RawGenerationSettings,
    onChunk: (textSoFar: string) => void,
    signal: AbortSignal
  ): Promise<string> => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatMessages,
        model: selectedModel,
        settings,
        stream: true,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch response");
    }

    const reader = response.body.getReader();
    // { stream: true } lets the decoder hold back an incomplete multi-byte
    // UTF-8 sequence split across two reads instead of corrupting it.
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let receivedDone = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remainder, malformedLine } = drainStreamLines(buffer);
        buffer = remainder;

        for (const event of events) {
          if (event.type === "chunk") {
            accumulated += event.text;
            onChunk(accumulated);
          } else if (event.type === "done") {
            receivedDone = true;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        if (malformedLine !== null) {
          throw new StreamProtocolError(
            "Received a malformed response from the server.",
            accumulated
          );
        }
        if (receivedDone) break;
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    if (!receivedDone) {
      throw new StreamProtocolError(
        "The response ended unexpectedly before completing.",
        accumulated
      );
    }

    return accumulated;
  };

  const setMessageContent = (convId: string, messageIndex: number, content: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m, i) => (i === messageIndex ? { ...m, content } : m)),
            }
          : c
      )
    );
  };

  const stopGeneration = () => {
    abortControllerRef.current?.abort();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || loading) return;

    const { settings, error: settingsError } = parseSettingsForm(settingsForm);
    if (settingsError) {
      setStatus(settingsError);
      return;
    }

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
    const finalConvId = convId;

    const userMessage: Message = { role: "user", content: prompt };
    const requestMessages = [...existingMessages, userMessage];
    const title =
      existingMessages.length === 0
        ? prompt.substring(0, 30) + (prompt.length > 30 ? "..." : "")
        : undefined;

    const token = ++activeRequestRef.current;
    const isCurrent = () => activeRequestRef.current === token;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setInput("");
    setLoading(true);
    setStatus("");

    if (streamingEnabled) {
      const assistantIndex = requestMessages.length;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === finalConvId
            ? {
                ...c,
                title: title ?? c.title,
                messages: [...requestMessages, { role: "assistant", content: "" }],
              }
            : c
        )
      );

      try {
        await requestAnswerStreaming(
          requestMessages,
          settings,
          (textSoFar) => {
            if (isCurrent()) setMessageContent(finalConvId, assistantIndex, textSoFar);
          },
          controller.signal
        );
        if (isCurrent()) setStatus("");
      } catch (error) {
        if (!isCurrent()) return;
        if (isAbortError(error)) {
          setStatus("Generation stopped.");
        } else {
          console.error("Error:", error);
          const message = error instanceof Error ? error.message : "Response could not be completed.";
          setStatus(message);
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
          abortControllerRef.current = null;
        }
      }
      return;
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.id === finalConvId ? { ...c, messages: requestMessages } : c
      )
    );

    try {
      const text = await requestAnswer(requestMessages, settings, controller.signal);
      if (!isCurrent()) return;
      const assistantMessage: Message = { role: "assistant", content: text };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === finalConvId
            ? {
                ...c,
                title: title ?? c.title,
                messages: [...requestMessages, assistantMessage],
              }
            : c
        )
      );
    } catch (error) {
      if (!isCurrent()) return;
      if (isAbortError(error)) {
        setStatus("Generation stopped.");
      } else {
        console.error("Error:", error);
        const message =
          error instanceof Error ? error.message : "Sorry, I encountered an error. Please try again.";
        setConversations((prev) =>
          prev.map((c) =>
            c.id === finalConvId
              ? {
                  ...c,
                  messages: [
                    ...requestMessages,
                    {
                      role: "assistant",
                      content: message,
                    },
                  ],
                }
              : c
          )
        );
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
        abortControllerRef.current = null;
      }
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

    const { settings, error: settingsError } = parseSettingsForm(settingsForm);
    if (settingsError) {
      setStatus(settingsError);
      return;
    }

    const requestMessages = messages.slice(0, promptIndex + 1);
    const convId = currentConvId;

    const token = ++activeRequestRef.current;
    const isCurrent = () => activeRequestRef.current === token;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setStatus(streamingEnabled ? "Generating..." : "Regenerating response...");

    if (streamingEnabled) {
      setMessageContent(convId, messageIndex, "");
      try {
        await requestAnswerStreaming(
          requestMessages,
          settings,
          (textSoFar) => {
            if (isCurrent()) setMessageContent(convId, messageIndex, textSoFar);
          },
          controller.signal
        );
        if (isCurrent()) setStatus("Response regenerated");
      } catch (error) {
        if (!isCurrent()) return;
        if (isAbortError(error)) {
          setStatus("Generation stopped.");
        } else {
          console.error("Regeneration error:", error);
          const message =
            error instanceof Error ? error.message : "Response could not be regenerated";
          setStatus(message);
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
          abortControllerRef.current = null;
        }
      }
      return;
    }

    try {
      const text = await requestAnswer(requestMessages, settings, controller.signal);
      if (!isCurrent()) return;
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === convId
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
      if (!isCurrent()) return;
      if (isAbortError(error)) {
        setStatus("Generation stopped.");
      } else {
        console.error("Regeneration error:", error);
        const message =
          error instanceof Error ? error.message : "Response could not be regenerated";
        setStatus(message);
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
        abortControllerRef.current = null;
      }
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
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors"
          >
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
                {MODELS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
                {process.env.NODE_ENV !== "production" && (
                  <option value={TEST_SYNTHETIC_STREAM_MODEL}>
                    Test: synthetic stream (dev only)
                  </option>
                )}
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
              {loading ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="px-6 py-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors font-medium"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  Send
                </button>
              )}
            </form>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Model settings"
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Model settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                <div>
                  <label htmlFor="setting-streaming" className="text-sm font-medium text-gray-700">
                    Stream responses
                  </label>
                  <p className="text-xs text-gray-500">
                    Show the reply as it's generated instead of waiting for the full response.
                  </p>
                </div>
                <input
                  id="setting-streaming"
                  type="checkbox"
                  checked={streamingEnabled}
                  onChange={(e) => setStreamingEnabled(e.target.checked)}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="setting-temperature"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Temperature
                </label>
                <input
                  id="setting-temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settingsForm.temperature}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, temperature: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Default 0.5. Range 0–2. Google's Gemini 3 guidance recommends keeping this at
                  1.0 for these models — lower values may cause looping or degraded reasoning.
                </p>
              </div>

              <div>
                <label
                  htmlFor="setting-top-p"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Top P
                </label>
                <input
                  id="setting-top-p"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settingsForm.topP}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, topP: e.target.value }))
                  }
                  placeholder="Model default"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Optional. Range 0–1.</p>
              </div>

              <div>
                <label
                  htmlFor="setting-top-k"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Top K
                </label>
                <input
                  id="setting-top-k"
                  type="number"
                  disabled
                  value=""
                  placeholder="Unavailable"
                  className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-400 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-amber-600">
                  Support not yet verified for this model.
                </p>
              </div>

              <div>
                <label
                  htmlFor="setting-max-output-tokens"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Maximum output tokens
                </label>
                <input
                  id="setting-max-output-tokens"
                  type="number"
                  min={1}
                  max={65536}
                  step={1}
                  value={settingsForm.maxOutputTokens}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, maxOutputTokens: e.target.value }))
                  }
                  placeholder="Model default"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Optional. Up to 65,536.</p>
              </div>

              <div>
                <label
                  htmlFor="setting-frequency-penalty"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Frequency penalty
                </label>
                <input
                  id="setting-frequency-penalty"
                  type="number"
                  disabled
                  value=""
                  placeholder="Unavailable"
                  className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-400 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-amber-600">
                  Support not yet verified for this model.
                </p>
              </div>

              <div>
                <label
                  htmlFor="setting-presence-penalty"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Presence penalty
                </label>
                <input
                  id="setting-presence-penalty"
                  type="number"
                  disabled
                  value=""
                  placeholder="Unavailable"
                  className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-400 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-amber-600">
                  Support not yet verified for this model.
                </p>
              </div>

              <div>
                <label
                  htmlFor="setting-stop-sequences"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Stop sequences
                </label>
                <input
                  id="setting-stop-sequences"
                  type="text"
                  value={settingsForm.stopSequences}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, stopSequences: e.target.value }))
                  }
                  placeholder="Comma-separated, up to 5"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Up to 5 sequences. Generation stops at the first match.
                </p>
              </div>

              <div>
                <label
                  htmlFor="setting-seed"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Seed
                </label>
                <input
                  id="setting-seed"
                  type="number"
                  step={1}
                  value={settingsForm.seed}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, seed: e.target.value }))
                  }
                  placeholder="Random"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Optional integer. Best-effort deterministic output.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => setSettingsForm(DEFAULT_SETTINGS_FORM)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Reset to defaults
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
