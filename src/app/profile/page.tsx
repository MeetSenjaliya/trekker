"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Calendar, MapPin, Star, Users, Camera, Edit, Settings, Clock, Activity, Award } from 'lucide-react';
import SnowEffect from '@/components/ui/SnowEffect';

// Interfaces remain the same...
interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string | null;
}

interface RecentTrek {
  id: string;
  title: string;
  image: string;
  date: string;
  location: string;
  rating: number;
  role: string;
}

interface UpcomingTrek {
  id: string;
  title: string;
  date: string;
  image: string;
  location: string;
  participants: {
    current: number;
    max: number;
  };
  role?: string;
}

// Sample data for badges
const badges = [
  { name: 'Mountain Master', icon: '🏔️', description: 'Completed 20+ mountain treks' },
  { name: 'Group Leader', icon: '👥', description: 'Successfully organized 5+ treks' },
  { name: 'Photo Pro', icon: '📸', description: 'Shared 50+ trek photos' },
  { name: 'Review Star', icon: '⭐', description: 'Received 4.5+ average rating' }
];

const defaultLocation = 'San Francisco, CA'; 
const defaultAvatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&h=200';
const defaultBio = 'Passionate trekker and outdoor enthusiast with over 5 years of experience exploring mountains around the world.';
const defaultJoinDate = 'March 2019';
const defaultTrekImage = 'https://images.unsplash.com/photo-1551632811-561732d1e306?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80';

export default function ProfilePage() {
  const [supabase] = useState(() => createClient());
  const { user, loading: isLoading } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [recentTreks, setRecentTreks] = useState<RecentTrek[]>([]);
  const [upcomingTreks, setUpcomingTreks] = useState<UpcomingTrek[]>([]);
  const [stats, setStats] = useState({
    treksCompleted: 0,
    treksOrganized: 0,
    totalDistance: '0 km',
    averageRating: 0
  });
  const [monthlyActivity, setMonthlyActivity] = useState({
    treks_joined: 0,
    photos_shared: 0,
    reviews_written: 0,
    distance_km: 0
  });
  const [loading, setLoading] = useState(true);

  // ... (useEffect Logic remains identical) ...
  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      setLoading(false);
      return;
    }
    
    const fetchData = async () => {
      try {
        await supabase.auth.getSession();

        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, bio, created_at')
          .eq('id', user.id)
          .single();
        setProfile(profileData);

        const { data: statsData } = await supabase
          .from('user_stats')
          .select('*')
          .eq('user_id', user.id)
          .single();
        
        if (statsData) {
          setStats({
            treksCompleted: statsData.treks_completed || 0,
            treksOrganized: statsData.treks_organised || 0,
            totalDistance: `${statsData.total_distance_km || 0} km`,
            averageRating: statsData.avg_rating || 0
          });
        }

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const { data: monthlyData } = await supabase
          .from('user_monthly_activity')
          .select('*')
          .eq('user_id', user.id)
          .eq('month', currentMonth)
          .single();

        if (monthlyData) {
          setMonthlyActivity({
            treks_joined: monthlyData.treks_joined || 0,
            photos_shared: monthlyData.photos_shared || 0,
            reviews_written: monthlyData.reviews_written || 0,
            distance_km: monthlyData.distance_km || 0
          });
        }

        // Recent Treks Fetch
        try {
          const { data: joinedTreks } = await supabase
            .from("trek_participants")
            .select(`
                id, trek_batches!inner (
                batch_date, treks (id, title, cover_image_url, rating, location)
                )`)
            .eq("user_id", user.id)
            .lt("trek_batches.batch_date", new Date().toISOString())
            .order("trek_batches(batch_date)", { ascending: false })
            .limit(3);

          setRecentTreks(
            joinedTreks?.map((t: any) => {
              const batch = Array.isArray(t.trek_batches) ? t.trek_batches[0] : t.trek_batches;
              const trek = batch?.treks;
              return {
                id: trek?.id,
                title: trek?.title,
                image: trek?.cover_image_url,
                date: batch?.batch_date ? new Date(batch.batch_date).toLocaleDateString() : 'Unknown Date',
                role: "Participant",
                rating: trek?.rating || 0,
                location: trek?.location || "Unknown Location",
              };
            }) || []
          );
        } catch (err) { console.error(err); }

        // Upcoming Treks Fetch
        try {
          const { data: upcoming } = await supabase
            .from("trek_participants")
            .select(`
                id, trek_batches!inner (
                batch_date, treks (id, title, cover_image_url, location, participants_joined, max_participants)
                )`)
            .eq("user_id", user.id)
            .gte("trek_batches.batch_date", new Date().toISOString())
            .order("trek_batches(batch_date)", { ascending: true })
            .limit(3);

          setUpcomingTreks(
            upcoming?.map((t: any) => {
              const batch = Array.isArray(t.trek_batches) ? t.trek_batches[0] : t.trek_batches;
              const trek = batch?.treks;
              return {
                id: trek?.id,
                title: trek?.title,
                date: batch?.batch_date ? new Date(batch.batch_date).toLocaleDateString() : 'Unknown Date',
                image: trek?.cover_image_url,
                location: trek?.location || "Unknown Location",
                participants: { current: trek?.participants_joined || 0, max: trek?.max_participants || 0 },
                role: "Participant",
              };
            }) || []
          );
        } catch (err) { console.error(err); }

      } catch (error) { console.error(error); } 
      finally { setLoading(false); }
    };

    fetchData();
  }, [user, supabase]);

  if (loading) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
        <SnowEffect />
        <div className="text-center relative z-10">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-blue-100/70">Loading profile...</p>
        </div>
      </div>
    );
  }

  const displayName = profile?.full_name || 'User';
  const displayAvatar = profile?.avatar_url || defaultAvatar;
  const displayJoinDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : defaultJoinDate;

  return (
    <div className="min-h-screen pt-24 pb-12 relative overflow-hidden text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <SnowEffect />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">

        {/* =========================================================================
            NEW "GLASS HORIZONTAL" PROFILE HEADER (Option 3)
           ========================================================================= */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-6 md:p-10 flex flex-col md:flex-row items-center gap-8 md:gap-12 relative overflow-hidden group mb-12 shadow-2xl">
            
            {/* Hover Glow Effect */}
            <div className="absolute -right-20 -top-20 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition duration-1000"></div>

            {/* Left: Avatar Area */}
            <div className="relative shrink-0">
                <div className="w-32 h-32 md:w-40 md:h-40 rounded-full p-1.5 bg-gradient-to-br from-blue-400 to-purple-500/0">
                    <img src={displayAvatar} alt={displayName} 
                         className="w-full h-full rounded-full object-cover border-4 border-[#1b2735] shadow-2xl" />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                    <span className="px-4 py-1 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[11px] font-bold uppercase tracking-wider rounded-full shadow-lg border border-blue-400/50">
                        Pro
                    </span>
                </div>
            </div>

            {/* Right: Details */}
            <div className="flex-1 text-center md:text-left z-10 w-full">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold text-white mb-1 drop-shadow-md">{displayName}</h1>
                        <p className="text-blue-200/60 text-sm font-light">Joined {displayJoinDate}</p>
                    </div>
                    
                    {/* Rating Stars */}
                    <div className="flex items-center justify-center md:justify-end gap-1 bg-black/20 px-3 py-1.5 rounded-full border border-white/5">
                        <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                        <span className="text-white font-bold text-sm ml-1">{stats.averageRating}</span>
                        <span className="text-xs text-gray-400 ml-1">(Rating)</span>
                    </div>
                </div>

                <p className="text-gray-300 leading-relaxed mb-6 max-w-2xl mx-auto md:mx-0 font-light">
                    {profile?.bio || defaultBio}
                </p>

                <div className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent my-6"></div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-8">
                        <div>
                            <p className="text-[10px] text-blue-300/70 uppercase font-bold tracking-wider mb-1">Location</p>
                            <div className="flex items-center gap-1.5 justify-center md:justify-start">
                                <MapPin className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-gray-200 text-sm">{defaultLocation}</span>
                            </div>
                        </div>
                        <div>
                            <p className="text-[10px] text-blue-300/70 uppercase font-bold tracking-wider mb-1">Total Distance</p>
                            <div className="flex items-center gap-1.5 justify-center md:justify-start">
                                <Activity className="w-3.5 h-3.5 text-green-400" />
                                <span className="text-gray-200 text-sm">{stats.totalDistance}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <Link href="/profile/edit" className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-all">
                            <Edit className="w-4 h-4" />
                            <span>Edit Profile</span>
                        </Link>
                        <button className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow-lg shadow-blue-500/20 transition-all">
                            Share Profile
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        {/* =========================================================================
            GRID LAYOUT FOR STATS & CONTENT
           ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column (Main Content) */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Stats Cards Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-white/5 to-transparent backdrop-blur-sm p-6 rounded-2xl border border-white/10 flex flex-col items-center">
                <div className="p-3 bg-blue-500/10 rounded-full mb-2"><Award className="w-6 h-6 text-blue-400" /></div>
                <div className="text-3xl font-bold text-white mb-0.5">{stats.treksCompleted}</div>
                <div className="text-xs text-blue-200/50 uppercase tracking-widest font-semibold">Completed</div>
              </div>
              <div className="bg-gradient-to-br from-white/5 to-transparent backdrop-blur-sm p-6 rounded-2xl border border-white/10 flex flex-col items-center">
                <div className="p-3 bg-green-500/10 rounded-full mb-2"><Users className="w-6 h-6 text-green-400" /></div>
                <div className="text-3xl font-bold text-white mb-0.5">{stats.treksOrganized}</div>
                <div className="text-xs text-green-200/50 uppercase tracking-widest font-semibold">Organized</div>
              </div>
            </div>

            {/* Recent Treks */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-white/10">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">Recent Adventures</h2>
                <Link href="/treks/history" className="text-sm text-blue-400 hover:text-blue-300">View All</Link>
              </div>
              
              <div className="space-y-4">
                {recentTreks.length > 0 ? recentTreks.map((trek) => (
                  <div key={trek.id} className="flex items-center gap-5 p-4 bg-black/20 border border-white/5 rounded-xl hover:border-white/20 transition-all group">
                    <img
                      src={trek.image || defaultTrekImage}
                      alt={trek.title}
                      className="w-20 h-20 rounded-lg object-cover shadow-md group-hover:scale-105 transition-transform"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-lg truncate">{trek.title}</h3>
                      <p className="text-sm text-gray-400 flex items-center gap-1.5 mb-2">
                        <Clock className="w-3.5 h-3.5" /> {trek.date}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${trek.role === 'Organizer'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                          {trek.role}
                        </span>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          <span className="text-xs text-gray-300 font-medium">{trek.rating}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )) : (
                    <div className="text-center py-8 text-gray-500">No recent treks found.</div>
                )}
              </div>
            </div>

            {/* Upcoming Treks */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-white/10">
              <h2 className="text-xl font-bold text-white mb-6">Upcoming Plans</h2>
              <div className="space-y-4">
                {upcomingTreks.length > 0 ? upcomingTreks.map((trek) => (
                  <div key={trek.id} className="flex items-center gap-5 p-4 bg-black/20 border border-white/5 rounded-xl hover:border-white/20 transition-all">
                    <div className="relative w-20 h-20 shrink-0">
                        <img src={trek.image || defaultTrekImage} alt={trek.title} className="w-full h-full rounded-lg object-cover shadow-md" />
                        <div className="absolute inset-0 bg-black/20 rounded-lg"></div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-lg truncate">{trek.title}</h3>
                      <p className="text-sm text-blue-300 flex items-center gap-1.5 mb-2">
                        <Calendar className="w-3.5 h-3.5" /> {trek.date}
                      </p>
                      <div className="flex items-center justify-between mt-1">
                        <div className="flex items-center gap-1 text-xs text-gray-400 bg-white/5 px-2 py-1 rounded-md">
                          <Users className="w-3 h-3" />
                          {trek.participants.current}/{trek.participants.max} joined
                        </div>
                         <button className="text-xs font-semibold text-blue-400 hover:text-white transition-colors">Details →</button>
                      </div>
                    </div>
                  </div>
                )) : (
                    <div className="text-center py-8 text-gray-500">No upcoming treks scheduled.</div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column (Sidebar) */}
          <div className="space-y-8">
            
            {/* Achievements */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl shadow-xl p-6 border border-white/10">
              <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-400" /> Achievements
              </h2>
              <div className="space-y-3">
                {badges.map((badge, index) => (
                  <div key={index} className="flex items-start gap-4 p-3 bg-black/20 border border-white/5 rounded-xl hover:bg-white/5 transition-colors">
                    <div className="text-2xl bg-white/5 p-2 rounded-lg">{badge.icon}</div>
                    <div>
                      <h3 className="font-bold text-white text-sm">{badge.name}</h3>
                      <p className="text-xs text-gray-400 leading-snug mt-0.5">{badge.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl shadow-xl p-6 border border-white/10">
              <h2 className="text-lg font-bold text-white mb-5">Quick Actions</h2>
              <div className="grid gap-3">
                <button className="w-full flex items-center gap-3 p-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl transition-all group text-left">
                  <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <Calendar className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-semibold text-white text-sm">Create New Trek</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all group text-left">
                  <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center text-green-400 group-hover:bg-green-500/30">
                    <Camera className="w-4 h-4" />
                  </div>
                  <span className="font-semibold text-gray-200 text-sm">Upload Photos</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all group text-left">
                  <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center text-purple-400 group-hover:bg-purple-500/30">
                    <Settings className="w-4 h-4" />
                  </div>
                  <span className="font-semibold text-gray-200 text-sm">Settings</span>
                </button>
              </div>
            </div>

            {/* Monthly Activity */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl shadow-xl p-6 border border-white/10">
              <h2 className="text-lg font-bold text-white mb-5">Monthly Activity</h2>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-white/5">
                    <span className="text-gray-400">Treks Joined</span>
                    <span className="text-white font-mono font-bold bg-white/10 px-2 py-0.5 rounded">{monthlyActivity.treks_joined}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-white/5">
                    <span className="text-gray-400">Photos</span>
                    <span className="text-white font-mono font-bold bg-white/10 px-2 py-0.5 rounded">{monthlyActivity.photos_shared}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-white/5">
                    <span className="text-gray-400">Reviews</span>
                    <span className="text-white font-mono font-bold bg-white/10 px-2 py-0.5 rounded">{monthlyActivity.reviews_written}</span>
                </div>
                <div className="pt-2">
                    <div className="text-xs text-gray-500 uppercase font-bold mb-1">Total Distance</div>
                    <div className="text-2xl font-bold text-white">{monthlyActivity.distance_km} <span className="text-base text-gray-400 font-normal">km</span></div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}