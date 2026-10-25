'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Send, Sparkles, Code2, Globe, MessageSquare,
  Loader2, Trash2, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type AgentType = 'nova' | 'code-assistant' | 'website-builder' | 'domain-advisor';

const AGENTS: { id: AgentType; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'nova', label: 'Nova', icon: <Sparkles className="h-4 w-4" />, desc: 'General hosting assistant' },
  { id: 'code-assistant', label: 'Code', icon: <Code2 className="h-4 w-4" />, desc: 'Deployment & server config' },
  { id: 'website-builder', label: 'Website', icon: <Globe className="h-4 w-4" />, desc: 'Build & configure sites' },
  { id: 'domain-advisor', label: 'Domain', icon: <MessageSquare className="h-4 w-4" />, desc: 'DNS, domains & SSL' },
];

export default function WebchatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agent, setAgent] = useState<AgentType>('nova');
  const messagesEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm ${AGENTS.find(a => a.id === agent)?.label || 'Nova'}, your ALO Labs AI assistant. How can I help you today?`,
        timestamp: new Date(),
      }]);
    }
  }, []);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: trimmed, timestamp: new Date() }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, agentType: agent }),
      });
      const data = await res.json();
      const reply = data.reply ?? data.data?.reply ?? data.message ?? 'Sorry, something went wrong.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date() }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please try again.', timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, agent]);

  const clearChat = () => {
    setMessages([{
      role: 'assistant',
      content: 'Chat cleared. How can I help?',
      timestamp: new Date(),
    }]);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Webchat</h1>
          <p className="text-sm text-slate-500">Chat with Nova and specialized AI agents</p>
        </div>
        <Button variant="outline" size="sm" onClick={clearChat} className="gap-1.5">
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>

      {/* Agent Selector */}
      <div className="flex gap-2 border-b border-slate-200 py-3">
        {AGENTS.map(a => (
          <button
            key={a.id}
            onClick={() => setAgent(a.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              agent === a.id
                ? 'bg-[#E8501A] text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'rounded-br-md bg-[#E8501A] text-white'
                : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              <p className={`mt-1 text-[10px] ${msg.role === 'user' ? 'text-white/60' : 'text-slate-400'}`}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </motion.div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <motion.span
                    key={i}
                    className="h-2 w-2 rounded-full bg-[#E8501A]"
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-end gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 focus-within:border-[#E8501A] focus-within:ring-2 focus-within:ring-[#E8501A]/10">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Type your message..."
            rows={1}
            className="max-h-[120px] min-h-[24px] flex-1 resize-none text-sm focus:outline-none"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E8501A] text-white transition hover:bg-[#C73D12] disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-slate-400">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
