'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  X,
  Send,
  ChevronDown,
  Sparkles,
  Code2,
  Globe,
  MessageSquare,
  Loader2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type AgentType = 'alolabs' | 'code-assistant' | 'website-builder' | 'domain-advisor';

interface AgentTab {
  id: AgentType;
  label: string;
  icon: React.ReactNode;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_TABS: AgentTab[] = [
  { id: 'alolabs', label: 'General', icon: <Sparkles className='h-3 w-3' /> },
  { id: 'code-assistant', label: 'Code', icon: <Code2 className='h-3 w-3' /> },
  { id: 'website-builder', label: 'Website', icon: <Globe className='h-3 w-3' /> },
  { id: 'domain-advisor', label: 'Domain', icon: <MessageSquare className='h-3 w-3' /> },
];

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    "Hi! I'm ALOlabs, your ALO Labs AI assistant. I can help you with hosting, domains, coding, and building websites. What can I help you with today?",
  timestamp: new Date(),
};

// ─── Bouncing Dots (typing indicator) ───────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-2 w-2 rounded-full bg-[#E8501A]"
          animate={{ y: [0, -6, 0] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const timeStr = message.timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-md bg-[#F1F1F4] text-[#1E293B]'
            : 'rounded-bl-md border border-[#E2E8F0] bg-white text-[#1E293B]'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <p
          className={`mt-1 text-[10px] text-[#475569]/70 ${
            isUser ? 'text-right' : 'text-left'
          }`}
        >
          {timeStr}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AIChatWidget() {
  // State
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('alolabs');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showTabDropdown, setShowTabDropdown] = useState(false);
  const [hasBounced, setHasBounced] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeTab = AGENT_TABS.find((t) => t.id === agentType)!;

  // ── Bounce animation on first render ──────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => setHasBounced(true), 0);
    return () => clearTimeout(timer);
  }, []);

  // ── Add welcome message when panel first opens ────────────────────────────

  const prevIsOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpen.current && messages.length === 0) {
      setMessages([WELCOME_MESSAGE]);
    }
    prevIsOpen.current = isOpen;
  }, [isOpen, messages.length]);

  // ── Auto-scroll to bottom when messages change ────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Focus input when panel opens ──────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // ── Listen for external open events (e.g. from PricingSection "Ask ALOlabs") ──

  useEffect(() => {
    function handleALOlabsOpen() {
      setIsOpen(true);
    }
    window.addEventListener('alolabs:open', handleALOlabsOpen);
    return () => window.removeEventListener('alolabs:open', handleALOlabsOpen);
  }, []);

  // ── Close dropdown on outside click ───────────────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowTabDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          sessionId,
          agentType,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof payload.error === 'string' ? payload.error : payload.error?.message;
        throw new Error(detail || 'ALOlabs could not answer right now. Please try again.');
      }

      const data = payload.data ?? payload;
      if (data.sessionId) setSessionId(data.sessionId);
      const reply = typeof data.reply === 'string' ? data.reply : data.message;
      if (typeof reply !== 'string' || !reply.trim()) {
        throw new Error('ALOlabs returned an empty response. Please try again.');
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content:
          error instanceof Error ? error.message : 'ALOlabs ran into a problem. Please try again in a moment.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, sessionId, agentType]);

  // ── Handle keydown in input ───────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Auto-resize textarea ──────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Chat Panel ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-24 right-4 z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl sm:right-6 md:bottom-8 md:right-8"
            style={{
              width: 'min(380px, calc(100vw - 2rem))',
              height: 'min(520px, calc(100vh - 10rem))',
            }}
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div
              className="relative flex shrink-0 items-center justify-between px-4 py-3"
              style={{
                background: 'linear-gradient(135deg, #E8501A 0%, #0A5CFF 100%)',
              }}
            >
              {/* Left: icon + title */}
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    ALOlabs — AI Assistant
                  </h2>
                  {/* Agent type selector (compact dropdown) */}
                  <div className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowTabDropdown((v) => !v)}
                      className="mt-0.5 flex items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium text-white/90 transition-colors hover:bg-white/25"
                    >
                      {activeTab.icon}
                      <span>{activeTab.label}</span>
                      <ChevronDown
                        className={`h-2.5 w-2.5 transition-transform ${
                          showTabDropdown ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    <AnimatePresence>
                      {showTabDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 top-full z-10 mt-1 min-w-[140px] overflow-hidden rounded-lg bg-white py-1 shadow-lg"
                        >
                          {AGENT_TABS.map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => {
                                setAgentType(tab.id);
                                setShowTabDropdown(false);
                              }}
                              className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors ${
                                tab.id === agentType
                                  ? 'bg-[#FFF7ED] font-semibold text-[#E8501A]'
                                  : 'text-[#1E293B] hover:bg-gray-50'
                              }`}
                            >
                              {tab.icon}
                              {tab.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Right: close */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Messages Area ───────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto bg-[#FAFAFC] p-4 custom-scrollbar">
              <div className="flex flex-col gap-3">
                {messages.map((msg, idx) => (
                  <MessageBubble key={idx} message={msg} />
                ))}
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-start"
                  >
                    <div className="rounded-2xl rounded-bl-md border border-[#E2E8F0] bg-white">
                      <TypingDots />
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* ── Agent Tabs (horizontal) ─────────────────────────────── */}
            <div className="flex shrink-0 items-center gap-1 border-t border-[#E2E8F0] bg-white px-3 py-2">
              {AGENT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAgentType(tab.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                    tab.id === agentType
                      ? 'bg-[#E8501A] text-white shadow-sm'
                      : 'text-[#475569] hover:bg-[#FFF7ED] hover:text-[#E8501A]'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* ── Input Area ──────────────────────────────────────────── */}
            <div className="shrink-0 border-t border-[#E2E8F0] bg-white p-3">
              <div className="flex items-end gap-2 rounded-xl border border-[#E2E8F0] bg-[#FAFAFC] px-3 py-2 transition-colors focus-within:border-[#E8501A]/50 focus-within:shadow-[0_0_0_2px_rgba(232,80,26,0.08)]">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  rows={1}
                  className="max-h-[100px] min-h-[24px] flex-1 resize-none bg-transparent text-sm text-[#1E293B] placeholder:text-[#475569]/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E8501A] text-white transition-all hover:bg-[#C73D12] disabled:opacity-40 disabled:hover:bg-[#E8501A]"
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-center text-[10px] text-[#475569]/50">
                Press <kbd className="rounded border border-[#E2E8F0] px-1 py-0.5 text-[9px]">Enter</kbd> to send,{' '}
                <kbd className="rounded border border-[#E2E8F0] px-1 py-0.5 text-[9px]">Shift+Enter</kbd> for new line
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating Button ──────────────────────────────────────────────── */}
      <motion.button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-6 right-4 z-50 flex items-center gap-2.5 sm:right-6 md:bottom-6 md:right-8"
        initial={{ scale: 0, opacity: 0 }}
        animate={
          hasBounced
            ? {
                scale: [0, 1.15, 0.9, 1.05, 1],
                opacity: 1,
              }
            : { scale: 0, opacity: 0 }
        }
        transition={
          hasBounced
            ? {
                duration: 0.7,
                ease: 'easeOut',
                times: [0, 0.3, 0.5, 0.7, 1],
              }
            : { duration: 0 }
        }
        aria-label={isOpen ? 'Close ALOlabs chat' : 'Open ALOlabs chat'}
      >
        {/* Label pill */}
        <span
          className={`rounded-full px-3.5 py-2 text-sm font-semibold shadow-lg transition-all ${
            isOpen
              ? 'bg-white text-[#E8501A] shadow-md'
              : 'bg-white text-[#1E293B]'
          }`}
          style={{
            boxShadow: isOpen
              ? '0 4px 12px rgba(0,0,0,0.08)'
              : '0 4px 14px rgba(232,80,26,0.25)',
          }}
        >
          Ask ALOlabs
        </span>

        {/* Icon circle */}
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95"
          style={{
            backgroundColor: '#E8501A',
            boxShadow: '0 6px 20px rgba(232,80,26,0.4)',
          }}
        >
          {isOpen ? (
            <X className="h-6 w-6 text-white" />
          ) : (
            <Bot className="h-6 w-6 text-white" />
          )}
        </span>
      </motion.button>

      {/* ── Custom scrollbar styles ─────────────────────────────────────── */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </>
  );
}