'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Heart, Share2, MessageCircle, Camera, MapPin,
  Clock, Mountain, IndianRupee, Star,
  CheckCircle2, ChevronRight, Calendar
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import SnowEffect from '@/components/ui/SnowEffect';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { joinTrekBatchAndChat, leaveTrek } from '@/lib/joinTrek';
import { getDisplayParticipantCount, getParticipantCount } from '@/lib/utils';
import ReviewCard from '@/components/ui/ReviewCard';

// Animation Variants
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const }
  }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1
    }
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
  const [reviews, setReviews] = useState<any[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);

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
        const count = await getParticipantCount(id as string);
        setRealParticipantCount(count);
        const { data: reviewsData, error: reviewsError } = await supabase
          .from('trek_reviews')
          .select('*, profiles(full_name, avatar_url)')
          .eq('trek_id', id)
          .order('created_at', { ascending: false });

        if (reviewsError) console.error('Error fetching reviews:', reviewsError.message);
        else setReviews(reviewsData || []);
      }
      setLoading(false);
      setLoadingReviews(false);
    };
    if (id) fetchTrek();
  }, [id, supabase]);

  // Status Check Effects
  useEffect(() => {
    if (!user || !id) return;
    const checkJoinStatus = async () => {
      const { data } = await supabase
        .from('trek_participants')
        .select('batch_id, trek_batches!inner(trek_id)')
        .eq('user_id', user.id)
        .eq('trek_batches.trek_id', id)
        .maybeSingle();
      if (data) setJoinedBatchId(data.batch_id);
      else setJoinedBatchId(null);
    };
    checkJoinStatus();
  }, [id, user, supabase, isModalOpen]);

  useEffect(() => {
    const initFavoriteStatus = async () => {
      if (user) {
        const { data } = await supabase.from('favorites').select('*').eq('user_id', user.id).eq('trek_id', id).single();
        if (data) setIsLiked(true);
      }
    };
    initFavoriteStatus();
  }, [id, user, supabase]);

  const toggleFavorite = async () => {
    if (!user) { alert('Please log in to favorite this trek.'); return; }
    if (isLiked) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('trek_id', id);
      if (!error) setIsLiked(false);
    } else {
      const { error } = await supabase.from('favorites').insert([{ user_id: user.id, trek_id: id }]);
      if (!error) setIsLiked(true);
    }
  };

  const handleCheckboxChange = (item: string) => setCheckedItems(prev => ({ ...prev, [item]: !prev[item] }));
  const handleJoinTrek = () => setIsModalOpen(true);
  const handleConfirmJoin = async (date: string) => {
    if (!user) { alert('Please log in to join this trek.'); return; }
    const result = await joinTrekBatchAndChat({ userId: user.id, trekId: id as string, trekTitle: trek?.title || 'this trek', date });
    alert(result.message);
    if (result.success) {
      setIsModalOpen(false);
      const { data: refreshedTrek } = await supabase.from('treks').select('*, trek_batches(batch_date)').eq('id', id).single();
      if (refreshedTrek) setTrek(refreshedTrek);
    }
  };

  const handleChat = async () => {
    if (!user) { alert('Please log in to chat.'); return; }
    try {
      const { data, error } = await supabase.from("trek_participants").select(`batch_id, trek_batches!inner (trek_id, conversations!inner ( id ))`).eq("user_id", user.id).eq("trek_batches.trek_id", id).maybeSingle();
      if (error || !data) { alert("Please join a trek batch to access chat."); return; }
      const batch = Array.isArray(data.trek_batches) ? data.trek_batches[0] : data.trek_batches;
      const conversationId = batch?.conversations?.[0]?.id;
      if (conversationId) router.push(`/messages?conversationId=${conversationId}`);
      else alert('Chat not initialized yet.');
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#090a0f]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-blue-100/50 animate-pulse">Mounting your trek...</p>
      </motion.div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-200 selection:bg-blue-500/30 overflow-x-hidden">
      <SnowEffect />

      {/* Hero Section */}
      <section className="relative h-[65vh] w-full overflow-hidden">
        <Image
          src={trek.cover_image_url || DEFAULT_IMAGE}
          alt={trek.title}
          fill
          priority
          quality={100}
          className="object-cover object-center scale-105 transition-transform duration-1000 ease-out hover:scale-100"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090a0f] via-[#090a0f]/30 to-black/20" />

        {/* Actions */}
        <div className="absolute top-24 right-6 flex flex-col gap-3 z-20">
          <motion.button
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
            onClick={toggleFavorite}
            className={`p-3 rounded-full backdrop-blur-md transition-all ${isLiked ? 'bg-red-500 shadow-lg shadow-red-500/40' : 'bg-white/10 hover:bg-white/20 border border-white/20'
              }`}
          >
            <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
          </motion.button>
          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="p-3 rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 border border-white/20 transition-all">
            <Share2 className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Hero Title Area */}
        <div className="absolute bottom-0 left-0 w-full p-6 md:px-12 lg:px-24 pb-12">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-7xl mx-auto"
          >
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${trek.difficulty === 'Easy' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' :
              trek.difficulty === 'Moderate' ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' :
                'bg-rose-500/20 border-rose-500/50 text-rose-400'
              }`}>
              {trek.difficulty} Trek
            </span>
            <h1 className="text-4xl md:text-7xl font-black text-white mt-4 mb-4 drop-shadow-2xl tracking-tight">
              {trek.title}
            </h1>
            <div className="flex flex-wrap gap-4 text-sm font-medium text-slate-300">
              <div className="flex items-center gap-2 bg-white/5 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
                <MapPin className="w-4 h-4 text-blue-400" /> {trek.location}
              </div>
              <div className="flex items-center gap-2 bg-white/5 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" /> {trek.rating || '4.8'}/5
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-6 lg:px-12 py-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

          <div className="lg:col-span-2 space-y-16">
            {/* Quick Stats Grid */}
            <motion.div
              variants={staggerContainer} initial="hidden" animate="visible"
              className="grid grid-cols-2 md:grid-cols-4 gap-4"
            >
              <StatCard icon={<Clock className="text-blue-400" />} label="Time" value={`${trek.duration_hours}h`} />
              <StatCard icon={<Mountain className="text-purple-400" />} label="Distance" value={`${trek.distance_km}km`} />
              <StatCard icon={<Calendar className="text-emerald-400" />} label="Slots" value={`${trek.max_participants}`} />
              <StatCard icon={<IndianRupee className="text-amber-400" />} label="Cost" value={`₹${trek.estimated_cost}`} />
            </motion.div>

            {/* Content Sections */}
            <motion.section variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="space-y-4">
              <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                <span className="w-1.5 h-8 bg-blue-500 rounded-full inline-block" />
                The Experience
              </h2>
              <p className="text-xl text-slate-400 leading-relaxed font-light">
                {trek.description}
              </p>
            </motion.section>

            {/* Logistics */}
            <motion.section variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="bg-white/[0.03] rounded-3xl border border-white/10 p-8">
              <div className="divide-y divide-white/5">
                <DetailItem label="Meeting Point" value={trek.meeting_point} />
                {trek.meeting_point2 && <DetailItem label="Alternate Point" value={trek.meeting_point2} />}
                <DetailItem label="Next Batches" value={
                  trek.trek_batches?.length > 0
                    ? trek.trek_batches.map((b: any) => new Date(b.batch_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })).join(', ')
                    : 'Contact for dates'
                } />
              </div>
            </motion.section>

            {/* Itinerary */}
            {trek.plan && (
              <motion.section variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Route Itinerary</h2>
                <div className="relative border-l-2 border-blue-500/20 ml-4 pl-8 py-2">
                  <div className="absolute top-0 -left-[9px] w-4 h-4 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                  <div className="bg-white/5 p-8 rounded-3xl border border-white/10 backdrop-blur-sm">
                    <p className="text-slate-300 leading-relaxed italic text-lg">"{trek.plan}"</p>
                  </div>
                </div>
              </motion.section>
            )}

            {/* Checklist */}
            {trek.gear_checklist?.length > 0 && (
              <motion.section variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Gear Checklist</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {trek.gear_checklist.map((item: string, idx: number) => (
                    <motion.label key={idx} whileHover={{ x: 5 }} className={`flex items-center gap-4 p-5 rounded-2xl border transition-all cursor-pointer ${checkedItems[item] ? 'bg-blue-500/10 border-blue-500/40' : 'bg-white/5 border-white/10 hover:border-white/20'
                      }`}>
                      <div className="relative flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={checkedItems[item] || false}
                          onChange={() => handleCheckboxChange(item)}
                          className="peer appearance-none h-6 w-6 rounded-lg border-2 border-white/20 checked:bg-blue-500 checked:border-blue-500 transition-all"
                        />
                        <CheckCircle2 className="absolute w-4 h-4 text-white scale-0 transition-transform peer-checked:scale-100" />
                      </div>
                      <span className={`font-medium ${checkedItems[item] ? 'text-blue-200' : 'text-slate-400'}`}>
                        {item}
                      </span>
                    </motion.label>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Reviews */}
            <motion.section variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="space-y-8">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">Trekkers Feedback</h2>
                <div className="px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold uppercase">
                  {reviews.length} Reviews
                </div>
              </div>
              {loadingReviews ? (
                <div className="h-20 flex justify-center items-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent animate-spin rounded-full" /></div>
              ) : reviews.length > 0 ? (
                <div className="flex flex-col gap-6">
                  {reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
                </div>
              ) : (
                <div className="text-center py-16 bg-white/[0.02] rounded-3xl border-2 border-dashed border-white/5">
                  <p className="text-slate-500 font-medium">Be the first to leave a review!</p>
                </div>
              )}
            </motion.section>
          </div>

          {/* Sidebar */}
          <aside className="relative">
            <motion.div
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
              className="sticky top-28 space-y-6"
            >
              <div className="bg-white/[0.04] backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden relative group">
                {/* Visual Glow */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 blur-[80px] group-hover:bg-blue-500/20 transition-all" />

                <div className="relative space-y-8">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-1">Total Cost</p>
                      <h3 className="text-4xl font-black text-white">₹{trek.estimated_cost}</h3>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded-2xl">
                      <IndianRupee className="w-6 h-6 text-blue-400" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                      <span className="text-slate-500">Group Size</span>
                      <span className="text-white">{getDisplayParticipantCount(realParticipantCount)}/{trek.max_participants}</span>
                    </div>
                    <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <motion.div
                        initial={{ width: 0 }} animate={{ width: `${Math.min((getDisplayParticipantCount(realParticipantCount) / trek.max_participants) * 100, 100)}%` }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-blue-600 to-sky-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-4">
                    {joinedBatchId ? (
                      <div className="flex gap-2">
                        <div className="flex-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 py-4 rounded-2xl font-bold text-center flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-5 h-5" /> Joined
                        </div>
                        <button
                          onClick={async () => {
                            if (!confirm("Leave this trek?")) return;
                            const res = await leaveTrek(user!.id, joinedBatchId);
                            if (res.success) { setJoinedBatchId(null); window.location.reload(); }
                          }}
                          className="px-6 bg-white/5 hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/50 text-slate-400 hover:text-rose-400 rounded-2xl transition-all"
                        >
                          Leave
                        </button>
                      </div>
                    ) : (
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={handleJoinTrek}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-bold text-lg shadow-xl shadow-blue-900/40 flex items-center justify-center gap-3"
                      >
                        Book This Trek <ChevronRight className="w-5 h-5" />
                      </motion.button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={handleChat} className="flex flex-col items-center gap-2 bg-white/5 border border-white/10 py-4 rounded-2xl hover:bg-white/10 transition-colors group/btn">
                      <MessageCircle className="w-5 h-5 text-slate-400 group-hover/btn:text-blue-400 transition-colors" />
                      <span className="text-[10px] font-bold uppercase text-slate-500">Chat</span>
                    </button>
                    <button className="flex flex-col items-center gap-2 bg-white/5 border border-white/10 py-4 rounded-2xl hover:bg-white/10 transition-colors group/btn">
                      <Camera className="w-5 h-5 text-slate-400 group-hover/btn:text-purple-400 transition-colors" />
                      <span className="text-[10px] font-bold uppercase text-slate-500">Photos</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Trekkers Badge */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-3xl p-5">
                <div className="flex -space-x-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-9 h-9 rounded-full border-2 border-[#090a0f] bg-slate-800 flex items-center justify-center text-[10px] font-black">{i}</div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 font-medium leading-tight">
                  Join <span className="text-white font-bold">{realParticipantCount} others</span> on this journey
                </p>
              </motion.div>
            </motion.div>
          </aside>
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

// Sub-components
function StatCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number }) {
  return (
    <motion.div
      variants={fadeInUp}
      className="bg-white/[0.03] border border-white/10 p-5 rounded-3xl flex flex-col items-center text-center gap-1 hover:border-white/20 transition-colors group"
    >
      <div className="p-2.5 bg-white/5 rounded-xl mb-1 group-hover:scale-110 transition-transform">{icon}</div>
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</span>
      <span className="text-white font-bold text-lg">{value}</span>
    </motion.div>
  );
}

function DetailItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between py-5 items-center gap-6">
      <span className="text-slate-500 font-medium text-sm">{label}</span>
      <span className="text-slate-200 font-semibold text-right text-sm">{value}</span>
    </div>
  );
}