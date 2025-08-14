'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Heart, Share2, MessageCircle, Camera } from 'lucide-react';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
// import Chat from '@/components/ui/Chat';


const getDifficultyColor = (level: string) => {
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
  const [trek, setTrek] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [checkedItems, setCheckedItems] = useState<{ [key: string]: boolean }>({});
  const [userId, setUserId] = useState<string | null>(null);

  const DEFAULT_IMAGE = 'https://your-project.supabase.co/storage/v1/object/public/trek-profile/defaulttrek.jpeg';

  useEffect(() => {
    const fetchTrek = async () => {
      const { data, error } = await supabase
        .from('treks')
        .select('*')
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
  }, [id]);

  useEffect(() => {
    const initFavoriteStatus = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUserId(user.id);
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
  }, [id]);

  const toggleFavorite = async () => {
    if (!userId) {
      alert('Please log in to favorite this trek.');
      return;
    }

    if (isLiked) {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('trek_id', id);

      if (!error) {
        setIsLiked(false);
      }
    } else {
      const { error } = await supabase
        .from('favorites')
        .insert([{ user_id: userId, trek_id: id }]);

      if (!error) {
        setIsLiked(true);
      }
    }
  };

  
  const handleCheckboxChange = (item: string) => {
    setCheckedItems(prev => ({ ...prev, [item]: !prev[item] }));
  };

  const handleJoinTrek = () => setIsModalOpen(true);
  const handleConfirmJoin = () => alert(`Successfully joined ${trek?.title}!`);

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
                    <Detail label="Date & Time" value={new Date(trek.date).toLocaleString()} />
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
                    <button className="flex-1 flex items-center justify-center gap-2 bg-white border rounded-full p-2 hover:bg-slate-50">
                      <MessageCircle className="w-5 h-5 text-slate-600" />
                      <span className="text-sm text-slate-600">Chat</span>
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 bg-white border rounded-full p-2 hover:bg-slate-50">
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
