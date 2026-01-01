

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
    Heart, Share2, MessageCircle, Camera, MapPin,
    Calendar, Clock, Mountain, IndianRupee, Star,
    CheckCircle2, Users, ChevronRight
} from 'lucide-react';
import SnowEffect from '@/components/ui/SnowEffect';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { joinTrekBatchAndChat, leaveTrek } from '@/lib/joinTrek';
import { getDisplayParticipantCount, getParticipantCount } from '@/lib/utils';
import ReviewCard from '@/components/ui/ReviewCard';

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

    // ... (Keep all your existing useEffects and Logic exactly as they are) ...
    useEffect(() => {
        const fetchTrek = async () => {
            const { data, error } = await supabase
                .from('treks')
                .select('*, trek_batches(batch_date)')
                .eq('id', id)
                .single();

            if (error) {
                // console.error('Error fetching trek:', error.message);
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
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                <p className="text-blue-100/50 animate-pulse">Preparing your adventure...</p>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[#090a0f] text-slate-200 selection:bg-blue-500/30">
            <SnowEffect />

            {/* Hero Section - Full width with better overlay */}
            <div className="relative h-[60vh] w-full overflow-hidden">
                <div
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 hover:scale-105"
                    style={{ backgroundImage: `url("${trek.cover_image_url || DEFAULT_IMAGE}")` }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#090a0f] via-[#090a0f]/20 to-transparent" />

                {/* Floating Action Buttons */}
                <div className="absolute top-24 right-6 flex flex-col gap-3 z-20">
                    <button
                        onClick={toggleFavorite}
                        className={`p-3 rounded-full backdrop-blur-md transition-all active:scale-95 ${isLiked ? 'bg-red-500 shadow-lg shadow-red-500/40' : 'bg-white/10 hover:bg-white/20 border border-white/20'
                            }`}
                    >
                        <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
                    </button>
                    <button className="p-3 rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 border border-white/20 transition-all">
                        <Share2 className="w-5 h-5" />
                    </button>
                </div>

                {/* Hero Content */}
                <div className="absolute bottom-0 left-0 w-full p-6 md:px-12 lg:px-24 pb-12">
                    <div className="max-w-7xl mx-auto">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border ${trek.difficulty === 'Easy' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' :
                            trek.difficulty === 'Moderate' ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' :
                                'bg-rose-500/20 border-rose-500/50 text-rose-400'
                            }`}>
                            {trek.difficulty} Difficulty
                        </span>
                        <h1 className="text-4xl md:text-6xl font-black text-white mt-4 mb-4 drop-shadow-2xl">
                            {trek.title}
                        </h1>
                        <div className="flex flex-wrap gap-6 text-sm font-medium text-slate-300">
                            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
                                <MapPin className="w-4 h-4 text-blue-400" /> {trek.location}
                            </div>
                            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
                                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" /> {trek.rating || '4.8'}/5 Rating
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <main className="max-w-7xl mx-auto px-6 lg:px-12 py-12 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

                    {/* LEFT CONTENT */}
                    <div className="lg:col-span-2 space-y-12">

                        {/* Description */}
                        <section className="space-y-4">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                <div className="w-1 h-8 bg-blue-500 rounded-full" />
                                The Experience
                            </h2>
                            <p className="text-lg text-slate-400 leading-relaxed font-light">
                                {trek.description}
                            </p>
                        </section>

                        {/* Trek Quick Stats - Beautiful Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <StatCard icon={<Clock className="text-blue-400" />} label="Duration" value={`${trek.duration_hours}h`} />
                            <StatCard icon={<Mountain className="text-purple-400" />} label="Distance" value={`${trek.distance_km}km`} />
                            <StatCard icon={<Calendar className="text-emerald-400" />} label="Dates" value={trek.trek_batches?.length || 0} />
                            <StatCard icon={<IndianRupee className="text-amber-400" />} label="Cost" value={`₹${trek.estimated_cost}`} />
                        </div>

                        {/* Detailed Info List */}
                        <section className="bg-white/5 rounded-3xl border border-white/10 p-8 space-y-6">
                            <h3 className="text-xl font-bold text-white">Logistics & Route</h3>
                            <div className="divide-y divide-white/5">
                                <DetailItem label="Meeting Point" value={trek.meeting_point} />
                                {trek.meeting_point2 && <DetailItem label="Alternate Point" value={trek.meeting_point2} />}
                                <DetailItem label="Upcoming Batches" value={
                                    trek.trek_batches && trek.trek_batches.length > 0
                                        ? trek.trek_batches
                                            .map((b: any) => new Date(b.batch_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))
                                            .join(', ')
                                        : 'Check back soon'
                                } />
                            </div>
                        </section>

                        {/* Plan Section */}
                        {trek.plan && (
                            <section className="space-y-6">
                                <h2 className="text-2xl font-bold text-white">Itinerary</h2>
                                <div className="relative border-l-2 border-blue-500/20 ml-4 pl-8 py-2 space-y-8">
                                    <div className="absolute top-0 -left-[9px] w-4 h-4 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                                    <p className="text-slate-400 leading-relaxed italic bg-white/5 p-6 rounded-2xl border border-white/10">
                                        "{trek.plan}"
                                    </p>
                                </div>
                            </section>
                        )}

                        {/* Gear Checklist - Custom Styled */}
                        {trek.gear_checklist?.length > 0 && (
                            <section className="space-y-6">
                                <h2 className="text-2xl font-bold text-white">Essential Gear</h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {trek.gear_checklist.map((item: string, idx: number) => (
                                        <label key={idx} className={`group flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${checkedItems[item] ? 'bg-blue-500/10 border-blue-500/50' : 'bg-white/5 border-white/10 hover:border-white/30'
                                            }`}>
                                            <div className="relative flex items-center justify-center">
                                                <input
                                                    type="checkbox"
                                                    checked={checkedItems[item] || false}
                                                    onChange={() => handleCheckboxChange(item)}
                                                    className="peer appearance-none h-6 w-6 rounded-lg border-2 border-white/20 checked:bg-blue-500 checked:border-blue-500 transition-all"
                                                />
                                                <CheckCircle2 className={`absolute w-4 h-4 text-white scale-0 transition-transform peer-checked:scale-100`} />
                                            </div>
                                            <span className={`font-medium transition-colors ${checkedItems[item] ? 'text-blue-200' : 'text-slate-400 group-hover:text-slate-200'}`}>
                                                {item}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Reviews */}
                        <section className="space-y-6">
                            <div className="flex justify-between items-end">
                                <h2 className="text-2xl font-bold text-white">Community Reviews</h2>
                                <span className="text-blue-400 font-semibold">{reviews.length} total</span>
                            </div>
                            {loadingReviews ? (
                                <div className="h-40 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent animate-spin rounded-full" /></div>
                            ) : reviews.length > 0 ? (
                                <div className="flex flex-col gap-6">
                                    {reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
                                </div>
                            ) : (
                                <div className="text-center py-12 bg-white/5 rounded-3xl border-2 border-dashed border-white/10">
                                    <p className="text-slate-500">Be the first to share your journey!</p>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* RIGHT SIDEBAR - Floating Card */}
                    <aside>
                        <div className="sticky top-24 space-y-6">
                            <div className="bg-white/5 backdrop-blur-xl border border-white/20 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden relative group">
                                {/* Decorative glow */}
                                <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 blur-[100px] group-hover:bg-blue-500/20 transition-all" />

                                <div className="relative space-y-8">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">Pricing</p>
                                            <h3 className="text-4xl font-black text-white">₹{trek.estimated_cost}</h3>
                                        </div>
                                        <div className="bg-blue-500/20 text-blue-400 p-2 rounded-xl">
                                            <IndianRupee className="w-6 h-6" />
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-400">Available Slots</span>
                                            <span className="text-white font-bold">{getDisplayParticipantCount(realParticipantCount)}/{trek.max_participants}</span>
                                        </div>
                                        <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden p-0.5">
                                            <div
                                                className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-1000"
                                                style={{ width: `${Math.min((getDisplayParticipantCount(realParticipantCount) / trek.max_participants) * 100, 100)}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-3 pt-4">
                                        {joinedBatchId ? (
                                            <div className="flex gap-2">
                                                <div className="flex-1 bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 py-4 rounded-2xl font-bold text-center flex items-center justify-center gap-2">
                                                    <CheckCircle2 className="w-5 h-5" /> Enrolled
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm("Are you sure you want to leave?")) return;
                                                        const result = await leaveTrek(user!.id, joinedBatchId);
                                                        if (result.success) { setJoinedBatchId(null); window.location.reload(); }
                                                    }}
                                                    className="px-6 bg-rose-500/10 hover:bg-rose-500 border border-rose-500/50 hover:text-white text-rose-500 rounded-2xl transition-all"
                                                >
                                                    Leave
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={handleJoinTrek}
                                                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-blue-600/30 flex items-center justify-center gap-3"
                                            >
                                                Book Adventure <ChevronRight className="w-5 h-5" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <button onClick={handleChat} className="flex flex-col items-center gap-2 bg-white/5 border border-white/10 py-4 rounded-2xl hover:bg-white/10 transition-colors">
                                            <MessageCircle className="w-5 h-5 text-blue-400" />
                                            <span className="text-xs font-bold uppercase tracking-tighter text-slate-300">Group Chat</span>
                                        </button>
                                        <button className="flex flex-col items-center gap-2 bg-white/5 border border-white/10 py-4 rounded-2xl hover:bg-white/10 transition-colors">
                                            <Camera className="w-5 h-5 text-purple-400" />
                                            <span className="text-xs font-bold uppercase tracking-tighter text-slate-300">Gallery</span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Participants Card */}
                            <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
                                <div className="flex items-center gap-4">
                                    <div className="flex -space-x-3">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="w-10 h-10 rounded-full border-2 border-[#090a0f] bg-slate-800 flex items-center justify-center text-xs">
                                                {String.fromCharCode(64 + i)}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-sm text-slate-400 font-medium">
                                        <span className="text-white">+{realParticipantCount}</span> trekkers already joined
                                    </p>
                                </div>
                            </div>
                        </div>
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

// Refined Helper Components
function StatCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number }) {
    return (
        <div className="bg-white/5 border border-white/10 p-4 rounded-2xl flex flex-col items-center text-center gap-1 hover:bg-white/10 transition-colors">
            <div className="p-2 bg-white/5 rounded-lg mb-1">{icon}</div>
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</span>
            <span className="text-white font-bold">{value}</span>
        </div>
    );
}

function DetailItem({ label, value }: { label: string, value: string }) {
    return (
        <div className="flex justify-between py-4 items-center gap-4">
            <span className="text-slate-400 font-medium">{label}</span>
            <span className="text-white font-semibold text-right">{value}</span>
        </div>
    );
}
