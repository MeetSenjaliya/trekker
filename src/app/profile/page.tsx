"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Calendar, MapPin, Star, Users, Camera, Edit, Settings } from 'lucide-react';

// Define Profile interface based on schema
// Define Profile interface based on schema
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

// Sample data for badges (keeping as constants)
const badges = [
  { name: 'Mountain Master', icon: '🏔️', description: 'Completed 20+ mountain treks' },
  { name: 'Group Leader', icon: '👥', description: 'Successfully organized 5+ treks' },
  { name: 'Photo Pro', icon: '📸', description: 'Shared 50+ trek photos' },
  { name: 'Review Star', icon: '⭐', description: 'Received 4.5+ average rating' }
];

const defaultLocation = 'San Francisco, CA'; // Fallback since not in profiles schema
const defaultAvatar = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=256&q=80';
const defaultBio = 'Passionate trekker and outdoor enthusiast with over 5 years of experience exploring mountains around the world. Love sharing adventures with fellow hikers!';
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

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      setLoading(false);
      return;
    }
    console.log('User is logged in:', user);

    const fetchData = async () => {
      try {
        // Refresh session
        await supabase.auth.getSession();

        // Fetch profile from DB
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, bio, created_at')
          .eq('id', user.id)
          .single();
        console.log('Fetched profile:', profileData);

        if (profileError && profileError.code !== 'PGRST116') { // PGRST116 is no row found
          console.error('Profile RLS/Fetch error:', profileError);
        }
        setProfile(profileData);

        // Fetch stats
        const { data: statsData, error: statsError } = await supabase
          .from('user_stats')
          .select('*')
          .eq('user_id', user.id)
          .single();
        if (statsError && statsError.code !== 'PGRST116') {
          console.error('Error fetching stats:', statsError);
        }
        if (statsData) {
          setStats({
            treksCompleted: statsData.treks_completed || 0,
            treksOrganized: statsData.treks_organised || 0,
            totalDistance: `${statsData.total_distance_km || 0} km`,
            averageRating: statsData.avg_rating || 0
          });
        }

        // Fetch monthly activity
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const { data: monthlyData, error: monthlyError } = await supabase
          .from('user_monthly_activity')
          .select('*')
          .eq('user_id', user.id)
          .eq('month', currentMonth)
          .single();
        if (monthlyError && monthlyError.code !== 'PGRST116') {
          console.error('Error fetching monthly activity:', monthlyError);
        }
        if (monthlyData) {
          setMonthlyActivity({
            treks_joined: monthlyData.treks_joined || 0,
            photos_shared: monthlyData.photos_shared || 0,
            reviews_written: monthlyData.reviews_written || 0,
            distance_km: monthlyData.distance_km || 0
          });
        }

        // -------------------- RECENT TREKS JOINED -----------------------
        try {
          const { data: joinedTreks } = await supabase
            .from("trek_participants")
            .select(
              `
                id,
                trek_batches!inner (
                batch_date,
                treks (
                    id,
                    title,
                    cover_image_url,
                    rating,
                    location
                )
                )
            `
            )
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
        } catch (err: any) {
          console.error('Error fetching recent treks:', err);
        }

        // ------------------------- UPCOMING TREKS ------------------------
        try {
          const { data: upcoming } = await supabase
            .from("trek_participants")
            .select(
              `
                id,
                trek_batches!inner (
                batch_date,
                treks (
                    id,
                    title,
                    cover_image_url,
                    location,
                    participants_joined,
                    max_participants
                )
                )
            `
            )
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
                participants: {
                  current: trek?.participants_joined || 0,
                  max: trek?.max_participants || 0,
                },
                role: "Participant",
              };
            }) || []
          );
        } catch (err: any) {
          console.error('Error fetching upcoming treks:', err);
        }

      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, supabase]);

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>;
  }

  const displayName = profile?.full_name || 'User';
  const displayAvatar = profile?.avatar_url || defaultAvatar;
  const displayBio = profile?.bio || defaultBio;
  const displayLocation = defaultLocation; // No location in schema, using default
  const displayJoinDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : defaultJoinDate;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Profile Header */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-8">
          <div className="relative h-48 bg-gradient-to-r from-blue-500 to-blue-600">
            <div className="absolute inset-0 bg-black/20"></div>
            <div className="absolute top-4 right-4">
              <Link
                href="/profile/edit"
                className="flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm text-white rounded-lg hover:bg-white/30 transition-colors"
              >
                <Edit className="w-4 h-4" />
                Edit Profile
              </Link>
            </div>
          </div>

          <div className="relative px-6 pb-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 -mt-16">
              <img
                src={displayAvatar}
                alt={displayName}
                className="w-32 h-32 rounded-full border-4 border-white shadow-lg"
              />
              <div className="flex-1 sm:mb-4">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">{displayName}</h1>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 mb-3">
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {displayLocation}
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    Joined {displayJoinDate}
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    {stats.averageRating} rating
                  </div>
                </div>
                <p className="text-slate-700 leading-relaxed max-w-2xl">{displayBio}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-xl shadow-lg text-center">
                <div className="text-2xl font-bold text-blue-600 mb-1">
                  {stats.treksCompleted}
                </div>
                <div className="text-sm text-slate-600">Treks Completed</div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-lg text-center">
                <div className="text-2xl font-bold text-green-600 mb-1">
                  {stats.treksOrganized}
                </div>
                <div className="text-sm text-slate-600">Treks Organized</div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-lg text-center">
                <div className="text-2xl font-bold text-purple-600 mb-1">
                  {stats.totalDistance}
                </div>
                <div className="text-sm text-slate-600">Total Distance</div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-lg text-center">
                <div className="text-2xl font-bold text-yellow-600 mb-1">
                  {stats.averageRating}
                </div>
                <div className="text-sm text-slate-600">Avg. Rating</div>
              </div>
            </div>

            {/* Recent Treks */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">Recent Treks</h2>
              <div className="space-y-4">
                {recentTreks.map((trek) => (
                  <div key={trek.id} className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                    <img
                      src={trek.image || defaultTrekImage}
                      alt={trek.title}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{trek.title}</h3>
                      <p className="text-sm text-slate-600">{trek.date}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-1 rounded-full ${trek.role === 'Organizer'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                          }`}>
                          {trek.role}
                        </span>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          <span className="text-xs text-slate-600">{trek.rating}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upcoming Treks */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">Upcoming Treks</h2>
              <div className="space-y-4">
                {upcomingTreks.map((trek) => (
                  <div key={trek.id} className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                    <img
                      src={trek.image || defaultTrekImage}
                      alt={trek.title}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{trek.title}</h3>
                      <p className="text-sm text-slate-600">{trek.date}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-1 rounded-full ${trek.role === 'Organizer'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                          }`}>
                          {trek.role}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-slate-600">
                          <Users className="w-3 h-3" />
                          {trek.participants.current}/{trek.participants.max} joined
                        </div>
                      </div>
                    </div>
                    <button className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors">
                      View Details
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-8">
            {/* Achievements */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">Achievements</h2>
              <div className="space-y-4">
                {badges.map((badge, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <div className="text-2xl">{badge.icon}</div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">{badge.name}</h3>
                      <p className="text-xs text-slate-600">{badge.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">Quick Actions</h2>
              <div className="space-y-3">
                <button className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition-colors">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="font-medium text-slate-900">Create New Trek</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition-colors">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <Camera className="w-4 h-4 text-green-600" />
                  </div>
                  <span className="font-medium text-slate-900">Upload Photos</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition-colors">
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Star className="w-4 h-4 text-purple-600" />
                  </div>
                  <span className="font-medium text-slate-900">Write Review</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition-colors">
                  <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                    <Settings className="w-4 h-4 text-gray-600" />
                  </div>
                  <span className="font-medium text-slate-900">Account Settings</span>
                </button>
              </div>
            </div>

            {/* Activity Summary */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">This Month&apos;s</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 text-slate-600">Activity</th>
                    <th className="text-right py-2 text-slate-600">Count</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 text-slate-900">Treks Joined</td>
                    <td className="py-3 text-right font-semibold text-slate-900">{monthlyActivity.treks_joined}</td>
                  </tr>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 text-slate-900">Photos Shared</td>
                    <td className="py-3 text-right font-semibold text-slate-900">{monthlyActivity.photos_shared}</td>
                  </tr>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 text-slate-900">Reviews Written</td>
                    <td className="py-3 text-right font-semibold text-slate-900">{monthlyActivity.reviews_written}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-3 text-slate-900">Distance Covered</td>
                    <td className="py-3 text-right font-semibold text-slate-900">{monthlyActivity.distance_km} km</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}