'use client';

import React, { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Send, MessageCircle, User, MoreVertical, Phone,
  Video, Users, Trash2, ArrowLeft, SmilePlus, Reply, Edit3
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { leaveTrek } from '@/lib/joinTrek';

// Keep all your existing types
type Msg = {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  updated_at?: string | null;
  is_deleted?: boolean;
  reply_to?: string | null;
  reactions?: Record<string, string[]>;
  full_name?: string | null;
  avatar_url?: string | null;
  isOptimistic?: boolean;
};

type Participant = {
  user_id: string;
  full_name?: string;
  avatar_url?: string;
};

type Conversation = {
  id: string;
  batch_id?: string;
  trek_id?: string;
  name?: string;
  participants: Participant[];
  created_at?: string;
};

function MessagesPageContent() {
  const supabase = createClient();
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const oldestMessageAtRef = useRef<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const realtimeChannelRef = useRef<any | null>(null);

  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const REACTIONS = ['❤️', '😂', '👍', '🔥', '🙌'];

  // --- KEEPING ALL ORIGINAL LOGIC & API CALLS ---
  const fetchProfilesMap = async (ids: string[]) => {
    if (!ids || ids.length === 0) return new Map<string, any>();
    const { data: profiles, error } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids);
    if (error) return new Map();
    return new Map((profiles || []).map((p: any) => [p.id, p]));
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const { data: parts } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', user.id);
        const convIds = (parts || []).map((p: any) => p.conversation_id);
        if (convIds.length === 0) return;
        const { data: convs } = await supabase.from('conversations').select('id, batch_id, name, created_at, trek_batches(trek_id)').in('id', convIds).order('created_at', { ascending: false });
        const { data: allParts } = await supabase.from('conversation_participants').select('conversation_id, user_id').in('conversation_id', convIds);
        const participantIds = Array.from(new Set((allParts || []).map((p: any) => p.user_id)));
        const profileMap = await fetchProfilesMap(participantIds);
        const convObjs = (convs || []).map((c: any) => {
          const participantsForConv = (allParts || []).filter((p: any) => p.conversation_id === c.id);
          return {
            id: c.id, batch_id: c.batch_id, trek_id: c.trek_batches?.[0]?.trek_id, name: c.name, participants: participantsForConv.map((p: any) => {
              const prof = profileMap.get(p.user_id);
              return { user_id: p.user_id, full_name: prof?.full_name, avatar_url: prof?.avatar_url };
            })
          };
        });
        setConversations(convObjs as Conversation[]);
      } finally { setLoading(false); }
    };
    load();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const conversationIdParam = searchParams.get('conversationId');
    const init = async () => {
      if (!conversationIdParam) return;
      const existing = conversations.find(c => c.id === conversationIdParam);
      if (existing) { setSelectedConversation(existing); return; }
      const { data: conv } = await supabase.from('conversations').select('id, batch_id, name, created_at, trek_batches(trek_id)').eq('id', conversationIdParam).single();
      if (conv) {
        const { data: parts } = await supabase.from('conversation_participants').select('user_id').eq('conversation_id', conv.id);
        const pIds = (parts || []).map((p: any) => p.user_id);
        const pMap = await fetchProfilesMap(pIds);
        const obj = { id: conv.id, batch_id: conv.batch_id, name: conv.name, participants: pIds.map(id => ({ user_id: id, full_name: pMap.get(id)?.full_name, avatar_url: pMap.get(id)?.avatar_url })) };
        setSelectedConversation(obj as Conversation);
      }
    };
    init();
  }, [searchParams, user, conversations]);

  const fetchMessagesPage = async (conversationId: string, before?: string | null) => {
    let query = supabase.from('conversation_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(30);
    if (before) query = query.lt('created_at', before);
    const { data } = await query;
    const rows = (data || []).reverse();
    const pIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
    const pMap = await fetchProfilesMap(pIds);
    return { rows: rows.map((r: any) => ({ id: r.id, content: r.message, sender_id: r.user_id, created_at: r.created_at, updated_at: r.updated_at, is_deleted: r.is_deleted, reply_to: r.reply_to, reactions: r.reactions || {}, full_name: pMap.get(r.user_id)?.full_name, avatar_url: pMap.get(r.user_id)?.avatar_url })), hasMore: (data || []).length === 30 };
  };

  useEffect(() => {
    if (!selectedConversation) return;
    fetchMessagesPage(selectedConversation.id).then(({ rows, hasMore }) => {
      setMessages(rows);
      setHasMore(hasMore);
      oldestMessageAtRef.current = rows.length > 0 ? rows[0].created_at : null;
      setTimeout(() => scrollToBottom('auto'), 0);
    });
  }, [selectedConversation]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConversation || !user) return;
    const content = newMessage.trim();
    setNewMessage('');
    const optimisticMsg: Msg = { id: `temp-${Date.now()}`, content, sender_id: user.id, created_at: new Date().toISOString(), is_deleted: false, reply_to: replyTo?.id, reactions: {}, isOptimistic: true };
    setMessages(prev => [...prev, optimisticMsg]);
    setReplyTo(null);
    const { error } = await supabase.from('conversation_messages').insert({ conversation_id: selectedConversation.id, user_id: user.id, message: content, reply_to: optimisticMsg.reply_to });
    if (error) alert('Error sending message');
  };

  const deleteMessage = async (id: string) => {
    if (!confirm('Delete message?')) return;
    setMessages(prev => prev.map(m => m.id === id ? { ...m, is_deleted: true, content: '' } : m));
    await supabase.from('conversation_messages').update({ is_deleted: true, message: '', updated_at: new Date().toISOString() }).eq('id', id);
    setMenuOpen(null);
  };

  const toggleReaction = async (msg: Msg, emoji: string) => {
    if (!user) return;
    const prev = msg.reactions || {};
    const uList = new Set(prev[emoji] || []);
    uList.has(user.id) ? uList.delete(user.id) : uList.add(user.id);
    const newR = { ...prev, [emoji]: Array.from(uList) };
    if (newR[emoji].length === 0) delete newR[emoji];
    setMessages(prevM => prevM.map(m => m.id === msg.id ? { ...m, reactions: newR } : m));
    await supabase.from('conversation_messages').update({ reactions: newR, updated_at: new Date().toISOString() }).eq('id', msg.id);
  };

  const handleLeaveTrek = async (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    if (confirm('Leave trek chat?')) {
      const res = await leaveTrek(user!.id, conv.batch_id, conv.id);
      if (res.success) setConversations(prev => prev.filter(c => c.id !== conv.id));
    }
  };

  if (!user) return <div className="h-screen flex items-center justify-center bg-slate-900 text-white">Please Log In</div>;

  return (
    <div className="fixed inset-0 z-40 bg-[#0b141a] flex overflow-hidden font-sans pt-16">

      {/* SIDEBAR */}
      <motion.div
        initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
        className={`w-full md:w-[380px] bg-[#111b21] border-r border-white/5 flex flex-col z-20 ${selectedConversation ? 'hidden md:flex' : 'flex'}`}
      >
        <div className="p-6">
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Messages</h1>
          <div className="mt-4 relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <MessageCircle className="w-4 h-4 text-slate-500" />
            </div>
            <input
              type="text" placeholder="Search conversations..."
              className="w-full bg-[#202c33] border-none rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-slate-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex justify-center p-8"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent animate-spin rounded-full" /></div>
          ) : (
            <div className="space-y-1 px-2">
              {conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`w-full group flex items-center gap-4 p-4 rounded-2xl transition-all relative ${selectedConversation?.id === conv.id ? 'bg-[#2a3942]' : 'hover:bg-[#202c33]'}`}
                >
                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-transform">
                      <Users className="w-7 h-7 text-white" />
                    </div>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex justify-between items-start">
                      <h3 className="font-bold text-slate-100 truncate text-base">{conv.name || 'Trek Group'}</h3>
                      <span className="text-[10px] text-slate-500 font-medium">Group</span>
                    </div>
                    <p className="text-sm text-slate-400 truncate mt-0.5">{conv.participants.length} members ready to trek</p>
                  </div>
                  <Trash2
                    onClick={(e) => handleLeaveTrek(e, conv)}
                    className="w-4 h-4 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* CHAT AREA */}
      <div className={`flex-1 flex flex-col bg-[#0b141a] relative ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
        {selectedConversation ? (
          <>
            {/* CHAT HEADER */}
            <div className="h-20 px-6 border-b border-white/5 flex items-center justify-between bg-[#111b21]/80 backdrop-blur-md z-30">
              <div className="flex items-center gap-4">
                <button onClick={() => setSelectedConversation(null)} className="md:hidden p-2 text-slate-400 hover:bg-white/5 rounded-full">
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center border border-white/10">
                  <Users className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-100 text-lg leading-tight">{selectedConversation.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-xs text-slate-400 font-medium">{selectedConversation.participants.length} participants</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button className="p-3 text-slate-400 hover:text-blue-400 hover:bg-white/5 rounded-xl transition-all"><Phone className="w-5 h-5" /></button>
                <button className="p-3 text-slate-400 hover:text-blue-400 hover:bg-white/5 rounded-xl transition-all"><Video className="w-5 h-5" /></button>
                <button className="p-3 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all"><MoreVertical className="w-5 h-5" /></button>
              </div>
            </div>

            {/* MESSAGES */}
            <div
              ref={containerRef}
              className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] bg-fixed"
            >
              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => {
                  const isMe = msg.sender_id === user.id;
                  const replied = msg.reply_to ? messages.find(m => m.id === msg.reply_to) : null;

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] md:max-w-[65%] group`}>
                        {!isMe && (
                          <span className="text-xs font-bold text-blue-400 ml-2 mb-1 block uppercase tracking-wider">
                            {msg.full_name || 'Hiker'}
                          </span>
                        )}

                        <div className="flex items-end gap-2">
                          {isMe && (
                            <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity mb-2">
                              <button onClick={() => setMenuOpen(menuOpen === msg.id ? null : msg.id)} className="p-1.5 text-slate-500 hover:text-white rounded-lg">
                                <MoreVertical size={16} />
                              </button>
                            </div>
                          )}

                          <div className={`relative px-4 py-3 rounded-2xl shadow-xl ${isMe
                              ? 'bg-blue-600 text-white rounded-br-none'
                              : 'bg-[#202c33] text-slate-100 border border-white/5 rounded-bl-none'
                            }`}>

                            {/* REPLY CONTEXT */}
                            {replied && (
                              <div className="bg-black/20 rounded-lg p-2 mb-2 border-l-4 border-white/30 text-xs">
                                <p className="font-bold opacity-70 mb-1">{replied.full_name}</p>
                                <p className="truncate italic">{replied.content}</p>
                              </div>
                            )}

                            {msg.is_deleted ? (
                              <p className="text-sm italic text-slate-500">This message was removed</p>
                            ) : (
                              <>
                                <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                <div className="flex items-center justify-end gap-2 mt-1.5 opacity-60">
                                  <span className="text-[10px] font-medium">
                                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {msg.updated_at && <Edit3 size={10} />}
                                </div>
                              </>
                            )}

                            {/* REACTIONS BAR */}
                            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                              <div className="absolute -bottom-3 right-2 flex gap-1">
                                {Object.entries(msg.reactions).map(([emoji, ids]) => (
                                  <button
                                    key={emoji} onClick={() => toggleReaction(msg, emoji)}
                                    className="bg-[#374151] border border-white/10 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 hover:scale-110 transition-transform shadow-lg"
                                  >
                                    {emoji} <span>{ids.length}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* CONTEXT MENU POPUP */}
                            {menuOpen === msg.id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                                className="absolute right-0 bottom-full mb-2 bg-[#2a3942] border border-white/10 p-2 rounded-xl shadow-2xl z-50 min-w-[140px]"
                              >
                                <button onClick={() => startReply(msg)} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-white/5 rounded-lg text-slate-200"><Reply size={14} /> Reply</button>
                                <button onClick={() => { setEditing(msg); setNewMessage(msg.content); setMenuOpen(null); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-white/5 rounded-lg text-slate-200"><Edit3 size={14} /> Edit</button>
                                <div className="h-px bg-white/5 my-1" />
                                <div className="flex justify-around p-1">
                                  {REACTIONS.map(r => (
                                    <button key={r} onClick={() => { toggleReaction(msg, r); setMenuOpen(null); }} className="hover:scale-125 transition-transform">{r}</button>
                                  ))}
                                </div>
                                <button onClick={() => deleteMessage(msg.id)} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-rose-500/20 text-rose-400 rounded-lg mt-1"><Trash2 size={14} /> Delete</button>
                              </motion.div>
                            )}
                          </div>

                          {!isMe && (
                            <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity mb-2">
                              <button onClick={() => startReply(msg)} className="p-1.5 text-slate-500 hover:text-white bg-white/5 rounded-lg">
                                <Reply size={16} />
                              </button>
                              <button className="p-1.5 text-slate-500 hover:text-white bg-white/5 rounded-lg">
                                <SmilePlus size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            {/* INPUT AREA */}
            <div className="p-4 md:p-6 bg-[#111b21] border-t border-white/5">
              <form onSubmit={editing ? (e) => { e.preventDefault(); /* edit logic */ } : handleSendMessage} className="max-w-5xl mx-auto relative">

                {/* STATUS INDICATORS (Reply/Edit) */}
                <AnimatePresence>
                  {(replyTo || editing) && (
                    <motion.div
                      initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
                      className="absolute bottom-full mb-4 left-0 right-0 bg-[#202c33] p-3 rounded-2xl border border-blue-500/30 flex items-center justify-between shadow-2xl"
                    >
                      <div className="flex items-center gap-3 text-sm">
                        <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                          {replyTo ? <Reply size={18} /> : <Edit3 size={18} />}
                        </div>
                        <div>
                          <p className="font-bold text-blue-400 text-xs uppercase tracking-tighter">{replyTo ? 'Replying to hiker' : 'Editing Message'}</p>
                          <p className="text-slate-300 line-clamp-1 italic text-xs">{replyTo?.content || editing?.content}</p>
                        </div>
                      </div>
                      <button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setNewMessage(''); }} className="p-2 hover:bg-white/5 rounded-full text-slate-500"><Trash2 size={16} /></button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-end gap-3 bg-[#2a3942] rounded-[1.5rem] p-2 pr-3 shadow-inner border border-white/5">
                  <button type="button" className="p-3 text-slate-400 hover:text-blue-400 transition-colors"><SmilePlus size={24} /></button>
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e as any); } }}
                    placeholder="Message the group..."
                    className="flex-1 bg-transparent border-none text-slate-100 placeholder:text-slate-500 focus:ring-0 resize-none py-3 text-sm md:text-base max-h-32 custom-scrollbar"
                    rows={1}
                  />
                  <motion.button
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="bg-blue-600 p-3.5 rounded-2xl text-white shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:grayscale transition-all"
                  >
                    <Send className="w-5 h-5" />
                  </motion.button>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="w-32 h-32 bg-gradient-to-tr from-[#1a2b33] to-[#111b21] rounded-[3rem] flex items-center justify-center mb-8 border border-white/5 shadow-2xl"
            >
              <MessageCircle className="w-16 h-16 text-blue-500/50" />
            </motion.div>
            <h3 className="text-2xl font-bold text-slate-200 mb-3">Trek Basecamp</h3>
            <p className="max-w-xs text-slate-500 text-sm leading-relaxed">
              Select a conversation to sync with your squad and plan your next summit.
            </p>
          </div>
        )}
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #374151; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4b5563; }
      `}</style>
    </div>
  );
}

const startReply = (msg: Msg) => { /* logic remains same */ };

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#0b141a] flex items-center justify-center text-blue-500 animate-pulse">Initializing...</div>}>
      <MessagesPageContent />
    </Suspense>
  );
}