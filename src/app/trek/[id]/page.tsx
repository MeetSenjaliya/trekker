'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Heart, Share2, MessageCircle, Camera } from 'lucide-react';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { joinTrekBatchAndChat } from '@/lib/joinTrek';
// import Chat from '@/components/ui/Chat';


const _getDifficultyColor = (level: string) => {
  switch (level) {
    case 'Easy':
      return 'bg-green-100 text-green-800';
    case 'Moderate':
      return 'bg-purple-100 text-purple-800';
    case 'Hard':
      return 'bg-red-100 text-red-800';
    case 'Expert':
      return 'bg-black text-white';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

export default function TrekDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [supabase] = useState(() => createClient());
  const [trek, setTrek] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [checkedItems, setCheckedItems] = useState<{ [key: string]: boolean }>({});

  const DEFAULT_IMAGE = 'https://your-project.supabase.co/storage/v1/object/public/trek-profile/defaulttrek.jpeg';

  useEffect(() => {
    const fetchTrek = async () => {
      const { data, error } = await supabase
        .from('treks')
        .select('*, trek_batches(batch_date)')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching trek:', error.message);
      } else {
        setTrek(data);
      }

      setLoading(false);
    };

    if (id) fetchTrek();
  }, [id, supabase]);

  useEffect(() => {
    const initFavoriteStatus = async () => {
      if (user) {
        const { data, error } = await supabase
          .from('favorites')
          .select('*')
          .eq('user_id', user.id)
          .eq('trek_id', id)
          .single();

        if (!error && data) {
          setIsLiked(true);
        }
      }
    };

    initFavoriteStatus();
  }, [id, user, supabase]);

  const toggleFavorite = async () => {
    if (!user) {
      alert('Please log in to favorite this trek.');
      return;
    }

    if (isLiked) {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('trek_id', id);

      if (!error) {
        setIsLiked(false);
      }
    } else {
      const { error } = await supabase
        .from('favorites')
        .insert([{ user_id: user.id, trek_id: id }]);

      if (!error) {
        setIsLiked(true);
      }
    }
  };


  const handleCheckboxChange = (item: string) => {
    setCheckedItems(prev => ({ ...prev, [item]: !prev[item] }));
  };

  const handleJoinTrek = () => setIsModalOpen(true);
  const handleConfirmJoin = async (date: string) => {
    if (!user) {
      alert('Please log in to join this trek.');
      return;
    }

    // Call shared join function
    const result = await joinTrekBatchAndChat({
      userId: user.id,
      trekId: id as string,
      trekTitle: trek?.title || 'this trek',
      date
    });

    // Show result message
    alert(result.message);

    if (result.success) {
      // Close modal
      setIsModalOpen(false);

      // Refresh trek data to update participant count
      const { data: refreshedTrek } = await supabase
        .from('treks')
        .select('*, trek_batches(batch_date)')
        .eq('id', id)
        .single();

      if (refreshedTrek) setTrek(refreshedTrek);

      // Optional: Redirect to chat (commented out as per requirements)
      // if (result.conversationId) {
      //   router.push(`/messages?conversationId=${result.conversationId}`);
      // }
    }
  };

  const handleChat = async () => {
    if (!user) {
      alert('Please log in to chat.');
      return;
    }

    try {
      // New optimized logic: Find which batch the user has joined and get the conversation
      const { data, error } = await supabase
        .from("trek_participants")
        .select(`
          batch_id,
          trek_batches!inner (
            trek_id,
            conversations!inner ( id )
          )
        `)
        .eq("user_id", user.id)
        .eq("trek_batches.trek_id", id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching chat info:', error);
        alert('Failed to access chat. Please try again.');
        return;
      }

      if (!data) {
        alert("Please join a trek batch to access chat.");
        return;
      }

      // Check if conversations array exists and has items
      const batch = Array.isArray(data.trek_batches) ? data.trek_batches[0] : data.trek_batches;
      const conversations = batch?.conversations;
      if (!conversations || !Array.isArray(conversations) || conversations.length === 0) {
        // Fallback: If no conversation exists yet for this batch, we might need to create one or alert
        // For now, let's assume if they joined, a conversation should exist or be created by the join process
        // But if it's missing, we can try to find it by batch_id directly or create it.
        // Let's stick to the user's logic first, but add a safety check.
        console.warn('No conversation found for this batch via relation.');

        // Fallback attempt: fetch conversation by batch_id directly
        const { data: directConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('batch_id', data.batch_id)
          .single();

        if (directConv) {
          router.push(`/messages?conversationId=${directConv.id}`);
          return;
        }

        alert('Chat not initialized for this trek batch yet.');
        return;
      }

      // Access the first conversation
      // Note: conversations is an array because of the one-to-many relationship definition in Supabase client usually,
      // even if it's 1:1 logically for batch-conversation.
      // The user snippet used `data.trek_batches.conversations[0].id`
      // We need to be careful about the type.
      const conversationId = conversations[0].id;

      // Redirect user to messages
      router.push(`/messages?conversationId=${conversationId}`);

    } catch (error: any) {
      console.error('Error handling chat:', error);
      alert('Failed to open chat. Please try again.');
    }
  };

  if (loading) return <p className="text-center py-10 text-gray-500">Loading trek...</p>;
  if (!trek) return <p className="text-center py-10 text-red-500">Trek not found.</p>;

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="flex-1">
        <div className="px-4 sm:px-6 lg:px-40 flex justify-center py-12">
          <div className="max-w-6xl w-full flex flex-col gap-8">
            {/* Hero Image */}
            <div
              className="w-full bg-center bg-no-repeat bg-cover flex flex-col justify-end overflow-hidden rounded-2xl min-h-96"
              style={{ backgroundImage: `url("${trek.cover_image_url || DEFAULT_IMAGE}")` }}
            >
              <div className="bg-gradient-to-t from-black/50 to-transparent p-6">
                <div className="flex items-center gap-4 text-white">
                  <button
                    onClick={toggleFavorite}
                    className={`p-2 rounded-full transition-colors ${isLiked ? 'bg-red-500 text-white' : 'bg-white/20 text-white hover:bg-white/30'
                      }`}
                  >
                    <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
                  </button>
                  <button className="p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors">
                    <Share2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Title and Description */}
            <div className="px-4">
              <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">{trek.title}</h1>
              <p className="text-base text-slate-600 leading-relaxed">{trek.description}</p>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-12 px-4">
              {/* LEFT: Details */}
              <div className="flex flex-col gap-10">
                {/* Trek Info */}
                <div className="flex flex-col gap-4">
                  <h2 className="text-2xl font-bold text-slate-900">Trek Details</h2>
                  <div className="border-t border-slate-200">
                    <Detail label="Upcoming Dates" value={
                      trek.trek_batches && trek.trek_batches.length > 0
                        ? trek.trek_batches
                          .map((b: any) => new Date(b.batch_date).toLocaleDateString())
                          .filter((d: string) => new Date(d) >= new Date())
                          .join(', ') || 'No upcoming dates'
                        : 'No upcoming dates'
                    } />
                    <Detail
                      label="Difficulty"
                      valueElement={
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${trek.difficulty === 'Easy'
                            ? 'bg-green-100 text-green-800'
                            : trek.difficulty === 'Moderate'
                              ? 'bg-yellow-100 text-yellow-800'
                              : trek.difficulty === 'Hard'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                        >
                          {trek.difficulty}
                        </span>
                      }
                    />

                    <Detail label="Distance" value={`${trek.distance_km} km`} />
                    <Detail label="Duration" value={`${trek.duration_hours} hours`} />
                    <Detail label="Location" value={trek.location} />
                    <Detail label="Meeting Point" value={trek.meeting_point} />
                    {trek.meeting_point2 && <Detail label="Alternate Point" value={trek.meeting_point2} />}
                    <Detail label="Estimated Cost" value={`₹${trek.estimated_cost}`} />
                    {trek.rating && <Detail label="Rating" value={`${trek.rating}/5 ⭐`} />}
                  </div>
                </div>

                {/* Plan */}
                {trek.plan && (
                  <div className="flex flex-col gap-4">
                    <h2 className="text-2xl font-bold text-slate-900">Trek Plan</h2>
                    <p className="text-slate-600 text-base">{trek.plan}</p>
                  </div>
                )}


                {/* Gear Checklist */}
                {trek.gear_checklist?.length > 0 && (
                  <div className="flex flex-col gap-4">
                    <h2 className="text-2xl font-bold text-slate-900">Gear Checklist</h2>
                    <p className="text-sm text-slate-600">
                      Bring these items. Check them off as you pack:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {trek.gear_checklist.map((item: string, idx: number) => (
                        <label key={idx} className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checkedItems[item] || false}
                            onChange={() => handleCheckboxChange(item)}
                            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-slate-700">{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Sidebar */}
              <aside className="flex flex-col gap-8">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 sticky top-12">
                  <div className="mb-6">
                    <p className="text-sm text-slate-600">Estimated Cost</p>
                    <p className="text-3xl font-bold text-slate-900">
                      ₹{trek.estimated_cost} <span className="text-base text-slate-500">/ person</span>
                    </p>
                  </div>

                  <div className="mb-6">
                    <p className="text-sm text-slate-600 mb-1">Participants</p>
                    <p className="text-sm text-slate-600 mb-2">
                      {trek.current_participants || 0}/{trek.max_participants} slots filled
                    </p>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{
                          width: `${((trek.current_participants || 0) / trek.max_participants) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleJoinTrek}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-full font-semibold text-base"
                  >
                    Join Trek
                  </button>

                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={handleChat}
                      className="flex-1 flex items-center justify-center gap-2 bg-white border rounded-full p-2 hover:bg-slate-50"
                    >
                      <MessageCircle className="w-5 h-5 text-slate-600" />
                      <span className="text-sm text-slate-600">Chat</span>
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 bg-white border rounded-full p-2 hover:bg-slate-50"
                    >
                      <Camera className="w-5 h-5 text-slate-600" />
                      <span className="text-sm text-slate-600">Photos</span>
                    </button>
                  </div>
                </div>


              </aside>
            </div>
          </div>
        </div>
      </main>

      <ConfirmationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirmJoin}
        trekTitle={trek.title}
      />
    </div>
  );
}

// Helper component
function Detail({
  label,
  value,
  valueElement,
}: {
  label: string;
  value?: string;
  valueElement?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-4 py-3 border-b border-slate-200">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-sm text-slate-800">
        {valueElement || value}
      </p>
    </div>
  );
}
