'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, MessageCircle, User, MoreVertical, Phone, Video, Users } from 'lucide-react';

/**
 * MessagesPage (final)
 *
 * - Shows username above each message (resolved from profiles)
 * - Input text is black
 * - Optimistic UI for sends
 * - Infinite scroll (load older messages when user scrolls to top)
 *
 * Tables expected:
 * - conversations
 * - conversation_participants
 * - conversation_messages (id, conversation_id, user_id, message, created_at)
 * - profiles (id, full_name, avatar_url)
 *
 * Paste into app/messages/page.tsx
 */

type Msg = {
    id: string;
    content: string;
    sender_id: string;
    created_at: string;
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
    type: 'direct' | 'group';
    name?: string;
    participants: Participant[];
    created_at?: string;
};

export default function MessagesPage() {
    const supabase = createClient();
    const { user } = useAuth();
    const searchParams = useSearchParams();

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Msg[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);

    // paging / infinite scroll
    const PAGE_SIZE = 30;
    const [hasMore, setHasMore] = useState(true);
    const oldestMessageAtRef = useRef<string | null>(null); // timestamp of oldest loaded message

    // refs for scroll/real-time
    const containerRef = useRef<HTMLDivElement | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const realtimeChannelRef = useRef<any | null>(null);

    // helper: map profile ids -> profile
    const fetchProfilesMap = async (ids: string[]) => {
        if (!ids || ids.length === 0) return new Map<string, any>();
        const { data: profiles, error } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url')
            .in('id', ids);

        if (error) {
            console.error('Error fetching profiles:', error);
            return new Map();
        }
        return new Map((profiles || []).map((p: any) => [p.id, p]));
    };

    // autoscroll helper (scrolls to bottom)
    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, []);

    // whenever new messages array grows with newer messages, scroll to bottom
    useEffect(() => {
        // if last message is optimistic and we just added optimistically, also scroll
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // LOAD CONVERSATIONS (same as earlier logic but minimal)
    useEffect(() => {
        if (!user) return;
        let mounted = true;
        const load = async () => {
            setLoading(true);
            try {
                const { data: parts, error: partsErr } = await supabase
                    .from('conversation_participants')
                    .select('conversation_id')
                    .eq('user_id', user.id);

                if (partsErr) {
                    console.error('Error fetching user conversations:', partsErr);
                    throw new Error(`Failed to fetch user conversations: ${partsErr.message || JSON.stringify(partsErr)}`);
                }

                const convIds = (parts || []).map((p: any) => p.conversation_id);
                if (convIds.length === 0) {
                    if (mounted) setConversations([]);
                    return;
                }

                const { data: convs, error: convsErr } = await supabase
                    .from('conversations')
                    .select('id, type, name, created_at')
                    .in('id', convIds)
                    .order('created_at', { ascending: false });

                if (convsErr) {
                    console.error('Error fetching conversations details:', convsErr);
                    throw new Error(`Failed to fetch conversations details: ${convsErr.message || JSON.stringify(convsErr)}`);
                }

                const { data: allParts, error: allPartsErr } = await supabase
                    .from('conversation_participants')
                    .select('conversation_id, user_id')
                    .in('conversation_id', convIds);

                if (allPartsErr) {
                    console.error('Error fetching conversation participants:', allPartsErr);
                    throw new Error(`Failed to fetch conversation participants: ${allPartsErr.message || JSON.stringify(allPartsErr)}`);
                }

                const participantIds = Array.from(new Set((allParts || []).map((p: any) => p.user_id)));
                const profileMap = await fetchProfilesMap(participantIds);

                const convObjs = (convs || []).map((c: any) => {
                    const participantsForConv = (allParts || []).filter((p: any) => p.conversation_id === c.id);
                    return {
                        id: c.id,
                        type: c.type,
                        name: c.name,
                        created_at: c.created_at,
                        participants: participantsForConv.map((p: any) => {
                            const prof = profileMap.get(p.user_id);
                            return { user_id: p.user_id, full_name: prof?.full_name, avatar_url: prof?.avatar_url };
                        })
                    } as Conversation;
                });

                if (mounted) setConversations(convObjs);
            } catch (err: any) {
                console.error('Load conversations error:', err);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        return () => { mounted = false; };
    }, [user, supabase]);

    // Open conversation from query params (conversationId or startChatWith)
    useEffect(() => {
        if (!user) return;
        const conversationIdParam = searchParams.get('conversationId');
        const startChatWith = searchParams.get('startChatWith');

        const init = async () => {
            if (conversationIdParam) {
                const existing = conversations.find(c => c.id === conversationIdParam);
                if (existing) {
                    setSelectedConversation(existing);
                    return;
                }
                try {
                    const { data: conv, error: convErr } = await supabase
                        .from('conversations')
                        .select('id, type, name, created_at')
                        .eq('id', conversationIdParam)
                        .single();
                    if (convErr) throw convErr;

                    const { data: parts } = await supabase
                        .from('conversation_participants')
                        .select('user_id')
                        .eq('conversation_id', conv.id);

                    const participantIds = (parts || []).map((p: any) => p.user_id);
                    const profileMap = await fetchProfilesMap(participantIds);

                    const convObj: Conversation = {
                        id: conv.id,
                        type: conv.type,
                        name: conv.name,
                        participants: participantIds.map((id: string) => {
                            const prof = profileMap.get(id);
                            return { user_id: id, full_name: prof?.full_name, avatar_url: prof?.avatar_url };
                        })
                    };

                    setConversations(prev => (prev.find(c => c.id === convObj.id) ? prev : [convObj, ...prev]));
                    setSelectedConversation(convObj);
                } catch (err) {
                    console.error('Open conversation error:', err);
                }
                return;
            }

            if (startChatWith) {
                // same as earlier — check existing or create
                try {
                    const { data: myParts } = await supabase
                        .from('conversation_participants')
                        .select('conversation_id')
                        .eq('user_id', user.id);

                    const myConvIds = (myParts || []).map((p: any) => p.conversation_id);
                    if (myConvIds.length > 0) {
                        const { data: targetParts } = await supabase
                            .from('conversation_participants')
                            .select('conversation_id')
                            .eq('user_id', startChatWith)
                            .in('conversation_id', myConvIds);

                        if (targetParts && targetParts.length > 0) {
                            const convId = targetParts[0].conversation_id;
                            const existingConv = conversations.find(c => c.id === convId);
                            if (existingConv) {
                                setSelectedConversation(existingConv);
                                return;
                            }
                        }
                    }

                    // create new direct conv
                    const { data: newConv, error: createErr } = await supabase
                        .from('conversations')
                        .insert({ type: 'direct' })
                        .select()
                        .single();
                    if (createErr) throw createErr;

                    const { error: pErr } = await supabase
                        .from('conversation_participants')
                        .insert([{ conversation_id: newConv.id, user_id: user.id }, { conversation_id: newConv.id, user_id: startChatWith }]);
                    if (pErr) throw pErr;

                    const profileMap = await fetchProfilesMap([user.id, startChatWith]);

                    const newConversationObj: Conversation = {
                        id: newConv.id,
                        type: 'direct',
                        participants: [
                            { user_id: user.id, full_name: profileMap.get(user.id)?.full_name, avatar_url: profileMap.get(user.id)?.avatar_url },
                            { user_id: startChatWith, full_name: profileMap.get(startChatWith)?.full_name, avatar_url: profileMap.get(startChatWith)?.avatar_url }
                        ]
                    };

                    setConversations(prev => [newConversationObj, ...prev]);
                    setSelectedConversation(newConversationObj);
                } catch (err) {
                    console.error('Start direct chat error:', err);
                }
            }
        };

        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, user, conversations]);

    // Helper: fetch messages page (older messages)
    const fetchMessagesPage = async (conversationId: string, before?: string | null, pageSize = PAGE_SIZE) => {
        // if before is provided, fetch messages with created_at < before (older)
        // else fetch latest page
        try {
            let query = supabase
                .from('conversation_messages')
                .select('id, conversation_id, user_id, message, created_at')
                .order('created_at', { ascending: false }) // fetch newest first, we'll reverse
                .limit(pageSize);

            if (before) {
                query = query.lt('created_at', before);
            }

            const { data, error } = await query;
            if (error) {
                console.error('Fetch messages page error:', error);
                return { rows: [], hasMore: false };
            }

            // data is newest-first; reverse to ascending order for display
            const rows = (data || []).reverse();

            // resolve profiles for user_ids
            const profileIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
            const profileMap = await fetchProfilesMap(profileIds);

            const mapped: Msg[] = rows.map((r: any) => ({
                id: r.id,
                content: r.message,
                sender_id: r.user_id,
                created_at: r.created_at,
                full_name: profileMap.get(r.user_id)?.full_name,
                avatar_url: profileMap.get(r.user_id)?.avatar_url
            }));

            return {
                rows: mapped,
                hasMore: (data || []).length === pageSize
            };
        } catch (err) {
            console.error('fetchMessagesPage error:', err);
            return { rows: [], hasMore: false };
        }
    };

    // Load initial messages when conversation selected
    useEffect(() => {
        if (!selectedConversation) {
            setMessages([]);
            oldestMessageAtRef.current = null;
            setHasMore(true);
            // cleanup realtime
            if (realtimeChannelRef.current) {
                supabase.removeChannel(realtimeChannelRef.current);
                realtimeChannelRef.current = null;
            }
            return;
        }

        let mounted = true;
        const load = async () => {
            const { rows, hasMore: more } = await fetchMessagesPage(selectedConversation.id, undefined, PAGE_SIZE);
            if (!mounted) return;
            setMessages(rows);
            setHasMore(more);
            oldestMessageAtRef.current = rows.length > 0 ? rows[0].created_at : null;
            // scroll to bottom after initial load (no smooth to avoid jump)
            setTimeout(() => scrollToBottom('auto'), 0);
        };

        load();

        return () => { mounted = false; };
    }, [selectedConversation]); // eslint-disable-line

    // Infinite scroll: load older messages when user scrolls near top
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let loadingOlder = false;

        const handleScroll = async () => {
            if (!selectedConversation) return;
            if (!el) return;

            // If scrollTop is < 150px, load older messages (if hasMore)
            if (el.scrollTop < 150 && !loadingOlder && hasMore) {
                loadingOlder = true;

                try {
                    const before = oldestMessageAtRef.current;
                    const prevScrollHeight = el.scrollHeight;

                    const { rows, hasMore: more } = await fetchMessagesPage(selectedConversation.id, before, PAGE_SIZE);
                    if (!rows || rows.length === 0) {
                        setHasMore(false);
                        loadingOlder = false;
                        return;
                    }

                    // prepend rows, but maintain scroll position
                    setMessages(prev => {
                        // avoid duplicates
                        const existingIds = new Set(prev.map(m => m.id));
                        const newRows = rows.filter(r => !existingIds.has(r.id));
                        return [...newRows, ...prev];
                    });

                    // update oldest timestamp
                    oldestMessageAtRef.current = rows[0].created_at;

                    // after DOM updates, adjust scroll so viewport remains at same message
                    requestAnimationFrame(() => {
                        const newScrollHeight = el.scrollHeight;
                        el.scrollTop = newScrollHeight - prevScrollHeight + el.scrollTop;
                    });

                    setHasMore(more);
                } catch (err) {
                    console.error('Error loading older messages:', err);
                } finally {
                    loadingOlder = false;
                }
            }
        };

        el.addEventListener('scroll', handleScroll);
        return () => {
            el.removeEventListener('scroll', handleScroll);
        };
    }, [selectedConversation, hasMore]); // eslint-disable-line

    // Realtime subscription (single stable channel) for incoming messages
    useEffect(() => {
        // cleanup previous channel
        if (realtimeChannelRef.current) {
            supabase.removeChannel(realtimeChannelRef.current);
            realtimeChannelRef.current = null;
        }

        if (!selectedConversation) return;

        const convId = selectedConversation.id;

        const channel = supabase
            .channel(`public:conversation_messages:conversation_id=eq.${convId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'conversation_messages',
                    filter: `conversation_id=eq.${convId}`
                },
                (payload) => {
                    const newMsg = payload.new;
                    if (!newMsg) return;

                    // Remove matching optimistic message(s) (same user & same content) — avoid duplicates
                    setMessages(prev => {
                        const filtered = prev.filter(m => !(m.isOptimistic && m.sender_id === newMsg.user_id && m.content === newMsg.message));
                        // Don't duplicate if server message already exists
                        if (filtered.some(m => m.id === newMsg.id)) return filtered;
                        return [
                            ...filtered,
                            {
                                id: newMsg.id,
                                content: newMsg.message,
                                sender_id: newMsg.user_id,
                                created_at: newMsg.created_at,
                                // profile info may be missing — we'll resolve it in bulk below
                            }
                        ];
                    });

                    // fetch profile for this user and patch the message entries
                    (async () => {
                        try {
                            const { data: profile } = await supabase
                                .from('profiles')
                                .select('id, full_name, avatar_url')
                                .eq('id', newMsg.user_id)
                                .single();

                            if (profile) {
                                setMessages(prev => prev.map(m => m.id === newMsg.id ? { ...m, full_name: profile.full_name, avatar_url: profile.avatar_url } : m));
                            }
                        } catch (err) {
                            console.error('Error fetching profile for realtime msg:', err);
                        }
                    })();
                }
            )
            .subscribe();

        realtimeChannelRef.current = channel;

        return () => {
            if (realtimeChannelRef.current) {
                supabase.removeChannel(realtimeChannelRef.current);
                realtimeChannelRef.current = null;
            }
        };
    }, [selectedConversation, supabase]);

    // Send message with optimistic UI
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedConversation || !user) return;

        const content = newMessage.trim();
        setNewMessage('');

        // create optimistic message
        const tempId = `temp-${Date.now()}`;
        const optimisticMsg: Msg = {
            id: tempId,
            content,
            sender_id: user.id,
            created_at: new Date().toISOString(),
            full_name: undefined, // we'll resolve below
            avatar_url: undefined,
            isOptimistic: true
        };

        // resolve sender profile for optimistic display
        try {
            const { data: prof } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
            if (prof) {
                optimisticMsg.full_name = prof.full_name;
                optimisticMsg.avatar_url = prof.avatar_url;
            }
        } catch (err) {
            console.error('Error resolving my profile for optimistic message:', err);
        }

        // append optimistic
        setMessages(prev => [...prev, optimisticMsg]);
        // scroll to bottom
        setTimeout(() => scrollToBottom('smooth'), 20);

        // insert to DB
        try {
            const { error } = await supabase
                .from('conversation_messages')
                .insert({
                    conversation_id: selectedConversation.id,
                    user_id: user.id,
                    message: content
                });

            if (error) {
                console.error('Send error:', error);
                // remove optimistic message and notify user
                setMessages(prev => prev.filter(m => m.id !== tempId));
                alert('Failed to send message');
            }
            // On success, realtime will insert the real message and remove optimistic copy (reconciled in subscription)
        } catch (err) {
            console.error('Unexpected send error:', err);
            setMessages(prev => prev.filter(m => m.id !== tempId));
            alert('Failed to send message (unexpected)');
        }
    };

    // Helper: display name/avatar for conversation (direct vs group)
    const getConversationDisplay = (conv: Conversation) => {
        if (conv.type === 'group') return { name: conv.name || 'Group Chat', avatar: null };
        const other = conv.participants.find(p => p.user_id !== user?.id);
        return { name: other?.full_name || 'Unknown', avatar: other?.avatar_url || null };
    };

    // Render
    const groupChats = conversations.filter(c => c.type === 'group');
    const directChats = conversations.filter(c => c.type === 'direct');

    if (!user) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <p className="text-slate-600">Please log in to view messages.</p>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-64px)] bg-slate-50 flex">
            {/* Sidebar */}
            <div className={`w-full md:w-80 bg-white border-r border-slate-200 flex flex-col ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                <div className="p-4 border-b border-slate-200">
                    <h1 className="text-xl font-bold text-slate-800">Messages</h1>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="p-4 text-center text-slate-500">Loading chats...</div>
                    ) : conversations.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">
                            <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-20" />
                            <p>No conversations yet.</p>
                            <p className="text-sm mt-2">Start a chat from a user profile!</p>
                        </div>
                    ) : (
                        <div className="py-2">
                            {groupChats.length > 0 && (
                                <div className="mb-4">
                                    <h2 className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Trek Groups</h2>
                                    {groupChats.map(conv => {
                                        const display = getConversationDisplay(conv);
                                        return (
                                            <button
                                                key={conv.id}
                                                onClick={() => setSelectedConversation(conv)}
                                                className={`w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors border-l-4 ${selectedConversation?.id === conv.id ? 'bg-blue-50 border-l-blue-500' : 'border-l-transparent'}`}
                                            >
                                                <div className="relative">
                                                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                                                        <Users className="w-6 h-6 text-blue-600" />
                                                    </div>
                                                </div>
                                                <div className="flex-1 text-left">
                                                    <h3 className="font-semibold text-slate-900 truncate">{display.name}</h3>
                                                    <p className="text-sm text-slate-500 truncate">{conv.participants.length} participants</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {directChats.length > 0 && (
                                <div>
                                    <h2 className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Direct Messages</h2>
                                    {directChats.map(conv => {
                                        const display = getConversationDisplay(conv);
                                        return (
                                            <button
                                                key={conv.id}
                                                onClick={() => setSelectedConversation(conv)}
                                                className={`w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors border-l-4 ${selectedConversation?.id === conv.id ? 'bg-blue-50 border-l-blue-500' : 'border-l-transparent'}`}
                                            >
                                                <div className="relative">
                                                    {display.avatar ? (
                                                        <img src={display.avatar} alt={display.name} className="w-12 h-12 rounded-full object-cover" />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center">
                                                            <User className="w-6 h-6 text-slate-400" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 text-left">
                                                    <h3 className="font-semibold text-slate-900 truncate">{display.name}</h3>
                                                    <p className="text-sm text-slate-500 truncate">Click to view chat</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className={`flex-1 flex flex-col bg-white ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                {selectedConversation ? (
                    <>
                        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between bg-white shadow-sm z-10">
                            <div className="flex items-center gap-3">
                                <button onClick={() => setSelectedConversation(null)} className="md:hidden p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>

                                {(() => {
                                    const display = getConversationDisplay(selectedConversation);
                                    return (
                                        <>
                                            <div className="relative">
                                                {display.avatar ? (
                                                    <img src={display.avatar} alt={display.name} className="w-10 h-10 rounded-full object-cover" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                                                        <User className="w-5 h-5 text-slate-400" />
                                                    </div>
                                                )}
                                                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                                            </div>
                                            <div>
                                                <h2 className="font-bold text-slate-900">{getConversationDisplay(selectedConversation).name}</h2>
                                                <p className="text-xs text-green-600 font-medium">Online</p>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>

                            <div className="flex items-center gap-2">
                                <button className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors">
                                    <Phone className="w-5 h-5" />
                                </button>
                                <button className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors">
                                    <Video className="w-5 h-5" />
                                </button>
                                <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                                    <MoreVertical className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Messages container: use containerRef for scroll / infinite */}
                        <div ref={containerRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
                            {hasMore && (
                                <div className="text-center text-xs text-slate-400 mb-2">Scroll up to load older messages</div>
                            )}
                            {messages.map((msg) => {
                                const isMe = msg.sender_id === user.id;
                                return (
                                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[70%]`}>
                                            {/* Username */}
                                            {!isMe && (
                                                <div className="text-[12px] text-slate-600 mb-1">
                                                    {msg.full_name || 'Unknown'}
                                                </div>
                                            )}

                                            <div className={`rounded-2xl px-4 py-3 shadow-sm ${isMe ? 'bg-blue-500 text-white rounded-br-none' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-none'}`}>
                                                <p className="text-sm leading-relaxed">{msg.content}</p>
                                                <p className={`text-[10px] mt-1 text-right ${isMe ? 'text-blue-100' : 'text-slate-400'}`}>
                                                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    {msg.isOptimistic ? ' • sending…' : ''}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input: text is black via text-black class */}
                        <div className="p-4 bg-white border-t border-slate-200">
                            <form onSubmit={handleSendMessage} className="flex items-center gap-3 max-w-4xl mx-auto">
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Type a message..."
                                    className="flex-1 py-3 px-4 bg-slate-100 border-0 rounded-full focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-black"
                                />
                                <button
                                    type="submit"
                                    disabled={!newMessage.trim()}
                                    className="p-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all hover:shadow-lg transform active:scale-95"
                                >
                                    <Send className="w-5 h-5 ml-0.5" />
                                </button>
                            </form>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                            <MessageCircle className="w-10 h-10 text-slate-300" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-700 mb-2">Your Messages</h3>
                        <p className="max-w-xs text-center text-slate-500">Select a conversation from the sidebar to start chatting or connect with a new trekker.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
