'use client';

import { useState } from 'react';

export default function ChatSection() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (input.trim()) {
      setMessages([...messages, input]);
      setInput('');
    }
  };

  return (
    <div className="mt-10 border-t pt-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-4">Group Chat</h2>

      <div className="border rounded-lg p-4 h-80 overflow-y-auto bg-white shadow-inner">
        {messages.length === 0 ? (
          <p className="text-slate-500">No messages yet. Be the first to say hi!</p>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className="mb-2 text-slate-800">
              <span className="font-semibold">User:</span> {msg}
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 border border-gray-300 rounded-l-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Type your message..."
        />
        <button
          onClick={handleSend}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 rounded-r-lg"
        >
          Send
        </button>
      </div>
    </div>
  );
}
                                                                                                                                                                                                                            