'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Heart, Share2, MessageCircle, Camera } from 'lucide-react';
import SnowEffect from '@/components/ui/SnowEffect';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { joinTrekBatchAndChat, leaveTrek } from '@/lib/joinTrek';
import { getDisplayParticipantCount, getParticipantCount } from '@/lib/utils';
// import Chat from '@/components/ui/Chat';


const _getDifficultyColor = (level: string) => {
  switch (level) {
    case 'Easy':
      return 'bg-green-500/20 text-green-300 border border-green-500/30';
    case 'Moderate':
      return 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
    case 'Hard':
      return 'bg-red-500/20 text-red-300 border border-red-500/30';
    case 'Expert':
      return 'bg-black/50 text-white border border-white/20';
    default:
      return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
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
  const [joinedBatchId, setJoinedBatchId] = useState<string | null>(null);
  const [realParticipantCount, setRealParticipantCount] = useState<number>(0);

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
        // Fetch real participant count
        const count = await getParticipantCount(id as string);
        setRealParticipantCount(count);
      }

      setLoading(false);
    };

    if (id) fetchTrek();
  }, [id, supabase]);

  // Check if already joined
  useEffect(() => {
    if (!user || !id) return;

    const checkJoinStatus = async () => {
      const { data, error } = await supabase
        .from('trek_participants')
        .select('batch_id, trek_batches!inner(trek_id)')
        .eq('user_id', user.id)
        .eq('trek_batches.trek_id', id)
        .maybeSingle();

      if (data) {
        setJoinedBatchId(data.batch_id);
      } else {
        setJoinedBatchId(null);
      }
    };

    checkJoinStatus();
  }, [id, user, supabase, isModalOpen]); // Re-check when modal closes (after join)

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

  if (loading) return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <SnowEffect />
      <p className="text-center py-10 text-blue-100/70 relative z-10">Loading trek...</p>
    </div>
  );
  if (!trek) return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <SnowEffect />
      <p className="text-center py-10 text-red-400 relative z-10">Trek not found.</p>
    </div>
  );

  return (
    <div className="min-h-screen relative overflow-hidden text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <SnowEffect />
      <main className="flex-1 pt-20 relative z-10">
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
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">{trek.title}</h1>
              <p className="text-base text-gray-300 leading-relaxed">{trek.description}</p>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-12 px-4">
              {/* LEFT: Details */}
              <div className="flex flex-col gap-10">
                {/* Trek Info */}
                <div className="flex flex-col gap-4">
                  <h2 className="text-2xl font-bold text-white">Trek Details</h2>
                  <div className="border-t border-white/10">
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
                            ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                            : trek.difficulty === 'Moderate'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : trek.difficulty === 'Hard'
                                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                : 'bg-black/50 text-white border border-white/20'
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
                    <h2 className="text-2xl font-bold text-white">Trek Plan</h2>
                    <p className="text-gray-300 text-base">{trek.plan}</p>
                  </div>
                )}


                {/* Gear Checklist */}
                {trek.gear_checklist?.length > 0 && (
                  <div className="flex flex-col gap-4">
                    <h2 className="text-2xl font-bold text-white">Gear Checklist</h2>
                    <p className="text-sm text-gray-400">
                      Bring these items. Check them off as you pack:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {trek.gear_checklist.map((item: string, idx: number) => (
                        <label key={idx} className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checkedItems[item] || false}
                            onChange={() => handleCheckboxChange(item)}
                            className="h-5 w-5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500 checked:bg-blue-500 checked:border-transparent"
                          />
                          <span className="text-gray-300">{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Sidebar */}
              <aside className="flex flex-col gap-8">
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-6 sticky top-24 shadow-xl">
                  <div className="mb-6">
                    <p className="text-sm text-gray-400">Estimated Cost</p>
                    <p className="text-3xl font-bold text-white">
                      ₹{trek.estimated_cost} <span className="text-base text-gray-500">/ person</span>
                    </p>
                  </div>

                  <div className="mb-6">
                    <p className="text-sm text-gray-400 mb-1">Participants</p>
                    <p className="text-sm text-gray-400 mb-2">
                      {getDisplayParticipantCount(realParticipantCount)}/{trek.max_participants} slots filled
                    </p>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{
                          width: `${(getDisplayParticipantCount(realParticipantCount) / trek.max_participants) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  {joinedBatchId ? (
                    <div className="flex gap-2">
                      <button
                        className="flex-1 bg-green-500 text-white py-3 rounded-full font-semibold text-base cursor-default"
                      >
                        Joined
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm("Are you sure you want to leave this trek?")) return;

                          const result = await leaveTrek(user!.id, joinedBatchId);

                          if (result.success) {
                            setJoinedBatchId(null);

                            // Refresh participant count
                            const { data: refreshedTrek } = await supabase
                              .from('treks')
                              .select('*, trek_batches(batch_date)')
                              .eq('id', id)
                              .single();
                            if (refreshedTrek) setTrek(refreshedTrek);

                            alert(result.message);
                          } else {
                            alert(result.message);
                          }
                        }}
                        className="px-6 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 py-3 rounded-full font-semibold text-base transition-colors"
                      >
                        Leave
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleJoinTrek}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-full font-semibold text-base shadow-lg hover:shadow-blue-500/50 transition-all"
                    >
                      Join Trek
                    </button>
                  )}

                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={handleChat}
                      className="flex-1 flex items-center justify-center gap-2 bg-white/5 border border-white/10 rounded-full p-2 hover:bg-white/10 transition-colors text-white"
                    >
                      <MessageCircle className="w-5 h-5 text-gray-300" />
                      <span className="text-sm text-gray-300">Chat</span>
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 bg-white/5 border border-white/10 rounded-full p-2 hover:bg-white/10 transition-colors text-white"
                    >
                      <Camera className="w-5 h-5 text-gray-300" />
                      <span className="text-sm text-gray-300">Photos</span>
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
    <div className="grid grid-cols-[150px_1fr] gap-4 py-3 border-b border-white/10">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-sm text-gray-200">
        {valueElement || value}
      </p>
    </div>
  );
}
