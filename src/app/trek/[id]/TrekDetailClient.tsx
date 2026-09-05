'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Heart, Share2, MessageCircle, Camera, MapPin,
  Clock, Mountain, IndianRupee, Star,
  CheckCircle2, ChevronRight, Calendar, Lock
} from 'lucide-react';
import { motion, Variants } from 'framer-motion';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { joinTrekBatchAndChat, leaveTrek } from '@/lib/joinTrek';
import { localToday } from '@/lib/schemas';
import { toast } from 'sonner';
import { getDisplayParticipantCount, getParticipantCount } from '@/lib/utils';
import { useIsTrekker } from '@/lib/queries';
import ReviewCard from '@/components/ui/ReviewCard';
import ItineraryView from '@/components/ui/ItineraryView';
import type { TrekBatch, TrekDetail, TrekReview } from '@/lib/server-queries';

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

interface TrekDetailClientProps {
  id: string;
  trek: TrekDetail;
  reviews: TrekReview[];
  initialParticipantCount: number;
}

const DEFAULT_IMAGE = 'https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/trek-profile/defaulttrek.jpeg';

// trek_participants row with its trek_batches embed. Supabase types a to-one
// embed as an object, but PostgREST answers with an array in some shapes — both
// are handled rather than cast away.
type JoinedRow = {
  batch_id: string;
  status: string;
  trek_batches: { batch_date: string } | { batch_date: string }[] | null;
};

const batchDateOf = (row: JoinedRow): string => {
  const b = Array.isArray(row.trek_batches) ? row.trek_batches[0] : row.trek_batches;
  return b?.batch_date ?? '';
};

// The booking the sidebar reports on, and the one "Leave" cancels. Earliest
// UPCOMING departure, not earliest overall — a repeat booker with a walked trek
// and a new date would otherwise be shown the completed one and leave that.
// Falls back to the whole set so a purely historic booking still shows as joined.
const pickCurrentBooking = (rows: JoinedRow[]): JoinedRow | undefined => {
  const today = localToday();
  const upcoming = rows.filter((r) => batchDateOf(r) >= today);
  return (upcoming.length ? upcoming : rows)
    .slice()
    .sort((a, b) => batchDateOf(a).localeCompare(batchDateOf(b)))[0];
};

export default function TrekDetailClient({
  id,
  trek,
  reviews,
  initialParticipantCount,
}: TrekDetailClientProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [supabase] = useState(() => createClient());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [checkedItems, setCheckedItems] = useState<{ [key: string]: boolean }>({});
  const [joinedBatchId, setJoinedBatchId] = useState<string | null>(null);
  const [joinedStatus, setJoinedStatus] = useState<'confirmed' | 'waitlisted' | null>(null);
  const [realParticipantCount, setRealParticipantCount] = useState<number>(initialParticipantCount);

  // Re-sync when the server component re-renders with a fresher count
  // (router.refresh() after a join/leave).
  const [syncedParticipantCount, setSyncedParticipantCount] = useState<number>(initialParticipantCount);
  if (syncedParticipantCount !== initialParticipantCount) {
    setSyncedParticipantCount(initialParticipantCount);
    setRealParticipantCount(initialParticipantCount);
  }

  // Status Check Effects
  useEffect(() => {
    if (!user || !id) return;
    const checkJoinStatus = async () => {
      // Nothing stops a trekker booking several departures of the same trek
      // (trek_participants is unique on (user_id, batch_id), not on the trek), so
      // this must not assume a single row — maybeSingle() errors on two and the
      // page would then offer "Book This Trek" to someone already booked, with no
      // way to leave.
      const { data } = await supabase
        .from('trek_participants')
        .select('batch_id, status, trek_batches!inner(trek_id, batch_date)')
        .eq('user_id', user.id)
        .eq('trek_batches.trek_id', id);
      const rows = (data ?? []) as JoinedRow[];
      const current = pickCurrentBooking(rows);
      if (current) {
        setJoinedBatchId(current.batch_id);
        setJoinedStatus(current.status === 'waitlisted' ? 'waitlisted' : 'confirmed');
      } else {
        setJoinedBatchId(null);
        setJoinedStatus(null);
      }
    };
    checkJoinStatus();
  }, [id, user, supabase, isModalOpen]);

  useEffect(() => {
    const initFavoriteStatus = async () => {
      if (!user) { setIsLiked(false); return; }
      // maybeSingle(), not single(): "not favorited" is the common case and
      // single() turns it into a PGRST116 error instead of an empty result.
      const { data } = await supabase.from('favorites').select('trek_id').eq('user_id', user.id).eq('trek_id', id).maybeSingle();
      setIsLiked(!!data);
    };
    initFavoriteStatus();
  }, [id, user, supabase]);

  const toggleFavorite = async () => {
    if (!user) { toast.error('Please log in to favorite this trek.'); return; }
    if (isLiked) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('trek_id', id);
      if (!error) setIsLiked(false);
    } else {
      const { error } = await supabase.from('favorites').insert([{ user_id: user.id, trek_id: id }]);
      if (!error) setIsLiked(true);
    }
  };

  // Company accounts browse the catalogue but can't book or favourite — both are
  // refused in Postgres, so don't offer controls guaranteed to fail. Signed-out
  // visitors keep them; they prompt for login.
  const { data: isTrekker } = useIsTrekker(user?.id);
  const canBook = !user || isTrekker === true;

  const handleCheckboxChange = (item: string) => setCheckedItems(prev => ({ ...prev, [item]: !prev[item] }));
  const handleJoinTrek = () => setIsModalOpen(true);
  const handleConfirmJoin = async (date: string) => {
    if (!user) { toast.error('Please log in to join this trek.'); return; }
    const result = await joinTrekBatchAndChat({ userId: user.id, trekId: id, trekTitle: trek?.title || 'this trek', date });
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
    if (result.success) {
      setIsModalOpen(false);
      if (result.batchId) setJoinedBatchId(result.batchId);
      if (result.status) setJoinedStatus(result.status);
      setRealParticipantCount(await getParticipantCount(id));
      // Trek row + batches are server props now — re-run the server render.
      router.refresh();
    }
  };

  const handleChat = async () => {
    if (!user) { toast.error('Please log in to chat.'); return; }
    if (joinedStatus === 'waitlisted') {
      toast.info("You're on the waitlist — group chat unlocks automatically once a spot opens and you're confirmed.");
      return;
    }
    try {
      // Same multi-booking caveat as checkJoinStatus: don't collapse to one row.
      // Open the chat for the departure the sidebar is reporting on.
      const { data, error } = await supabase.from("trek_participants").select(`batch_id, trek_batches!inner (trek_id, conversations!inner ( id ))`).eq("user_id", user.id).eq("trek_batches.trek_id", id);
      const rows = data ?? [];
      if (error || rows.length === 0) { toast.error("Please join a trek batch to access chat."); return; }
      const row = rows.find((r) => r.batch_id === joinedBatchId) ?? rows[0];
      const batch = Array.isArray(row.trek_batches) ? row.trek_batches[0] : row.trek_batches;
      const conversationId = batch?.conversations?.[0]?.id;
      if (conversationId) router.push(`/messages?conversationId=${conversationId}`);
      else toast.error('Chat not initialized yet.');
    } catch (e) { console.error(e); }
  };

  // Real ratings rollup: average the trek's reviews (already fetched above).
  // Falls back to the static treks.rating column only when there are no reviews.
  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  const displayRating = avgRating ?? trek.rating ?? '4.8';

  // Supabase returns the forward FK embed as an object, but type it defensively.
  const company = Array.isArray(trek.companies) ? trek.companies[0] : trek.companies;

  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-200 selection:bg-blue-500/30 overflow-x-hidden">

      {/* Hero Section */}
      <section className="relative h-[65vh] w-full overflow-hidden">
        <Image
          src={trek.cover_image_url || DEFAULT_IMAGE}
          alt={trek.title || 'Trek'}
          fill
          priority
          quality={100}
          className="object-cover object-center scale-105 transition-transform duration-1000 ease-out hover:scale-100"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090a0f] via-[#090a0f]/30 to-black/20" />

        {/* Actions */}
        <div className="absolute top-24 right-6 flex flex-col gap-3 z-20">
          {canBook && (
            <motion.button
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={toggleFavorite}
              className={`p-3 rounded-full backdrop-blur-md transition-all ${isLiked ? 'bg-red-500 shadow-lg shadow-red-500/40' : 'bg-white/10 hover:bg-white/20 border border-white/20'
                }`}
            >
              <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
            </motion.button>
          )}
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
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" /> {displayRating}/5
              </div>
            </div>
            {company && (
              <p className="mt-4 text-sm text-slate-300">
                Organized by{' '}
                <Link
                  href={`/company/${company.slug}`}
                  className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                >
                  {company.name}
                </Link>
              </p>
            )}
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
                <DetailItem label="Meeting Point" value={trek.meeting_point || 'TBD'} />
                {trek.meeting_point2 && <DetailItem label="Alternate Point" value={trek.meeting_point2} />}
                <DetailItem label="Next Batches" value={
                  (trek.trek_batches?.length ?? 0) > 0
                    ? trek.trek_batches!.map((b: TrekBatch) => new Date(b.batch_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })).join(', ')
                    : 'Contact for dates'
                } />
              </div>
            </motion.section>

            {/* Itinerary */}
            {trek.plan && (
              <motion.section variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Route Itinerary</h2>
                <ItineraryView plan={trek.plan} />
              </motion.section>
            )}

            {/* Checklist */}
            {(trek.gear_checklist?.length ?? 0) > 0 && (
              <motion.section variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Gear Checklist</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {trek.gear_checklist?.map((item: string, idx: number) => (
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
              {reviews.length > 0 ? (
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
                        initial={{ width: 0 }} animate={{ width: `${Math.min((getDisplayParticipantCount(realParticipantCount) / (trek.max_participants || 1)) * 100, 100)}%` }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-blue-600 to-sky-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-4">
                    {joinedBatchId ? (
                      <div className="flex gap-2">
                        {joinedStatus === 'waitlisted' ? (
                          <div className="flex-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 py-4 rounded-2xl font-bold text-center flex items-center justify-center gap-2">
                            <Clock className="w-5 h-5" /> On Waitlist
                          </div>
                        ) : (
                          <div className="flex-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 py-4 rounded-2xl font-bold text-center flex items-center justify-center gap-2">
                            <CheckCircle2 className="w-5 h-5" /> Joined
                          </div>
                        )}
                        <button
                          onClick={async () => {
                            if (!confirm(joinedStatus === 'waitlisted' ? "Leave the waitlist?" : "Leave this trek?")) return;
                            const res = await leaveTrek(user!.id, joinedBatchId);
                            if (res.success) { setJoinedBatchId(null); setJoinedStatus(null); window.location.reload(); }
                          }}
                          className="px-6 bg-white/5 hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/50 text-slate-400 hover:text-rose-400 rounded-2xl transition-all"
                        >
                          Leave
                        </button>
                      </div>
                    ) : canBook ? (
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={handleJoinTrek}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-bold text-lg shadow-xl shadow-blue-900/40 flex items-center justify-center gap-3"
                      >
                        Book This Trek <ChevronRight className="w-5 h-5" />
                      </motion.button>
                    ) : (
                      <div className="w-full bg-white/5 border border-white/10 text-slate-400 py-5 rounded-2xl text-center text-sm">
                        You&apos;re signed in as a trek company — booking is for trekker accounts.
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={handleChat}
                      title={joinedStatus === 'waitlisted' ? 'Chat unlocks once you’re confirmed off the waitlist' : undefined}
                      className={`flex flex-col items-center gap-2 border border-white/10 py-4 rounded-2xl transition-colors group/btn ${joinedStatus === 'waitlisted' ? 'bg-white/[0.02] opacity-60 cursor-not-allowed' : 'bg-white/5 hover:bg-white/10'}`}
                    >
                      {joinedStatus === 'waitlisted'
                        ? <Lock className="w-5 h-5 text-slate-500" />
                        : <MessageCircle className="w-5 h-5 text-slate-400 group-hover/btn:text-blue-400 transition-colors" />}
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
