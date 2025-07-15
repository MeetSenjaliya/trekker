import React from 'react';
import Link from 'next/link';
import { Calendar, MapPin, Star, Award, Users, Camera, Edit, Settings } from 'lucide-react';

// Sample user data
const userData = {
  name: 'Alex Johnson',
  avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=256&q=80',
  bio: 'Passionate trekker and outdoor enthusiast with over 5 years of experience exploring mountains around the world. Love sharing adventures with fellow hikers!',
  location: 'San Francisco, CA',
  joinDate: 'March 2019',
  stats: {
    treksCompleted: 24,
    treksOrganized: 8,
    totalDistance: '1,247 km',
    averageRating: 4.8
  },
  badges: [
    { name: 'Mountain Master', icon: '🏔️', description: 'Completed 20+ mountain treks' },
    { name: 'Group Leader', icon: '👥', description: 'Successfully organized 5+ treks' },
    { name: 'Photo Pro', icon: '📸', description: 'Shared 50+ trek photos' },
    { name: 'Review Star', icon: '⭐', description: 'Received 4.5+ average rating' }
  ],
  recentTreks: [
    {
      id: '1',
      title: 'Himalayan Heights',
      date: 'June 2024',
      image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80',
      role: 'Participant',
      rating: 5
    },
    {
      id: '2',
      title: 'Alps Adventure',
      date: 'May 2024',
      image: 'https://images.unsplash.com/photo-1464822759844-d150baec0494?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80',
      role: 'Organizer',
      rating: 4.8
    },
    {
      id: '3',
      title: 'Coastal Trail',
      date: 'April 2024',
      image: 'https://images.unsplash.com/photo-1506197603052-3cc9c3a201bd?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80',
      role: 'Participant',
      rating: 4.5
    }
  ],
  upcomingTreks: [
    {
      id: '4',
      title: 'Patagonia Expedition',
      date: 'August 15, 2024',
      image: 'https://images.unsplash.com/photo-1551632811-561732d1e306?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80',
      role: 'Organizer',
      participants: { current: 6, max: 10 }
    },
    {
      id: '5',
      title: 'Rocky Mountain Trail',
      date: 'September 3, 2024',
      image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80',
      role: 'Participant',
      participants: { current: 8, max: 12 }
    }
  ]
};

export default function ProfilePage() {
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
                src={userData.avatar}
                alt={userData.name}
                className="w-32 h-32 rounded-full border-4 border-white shadow-lg"
              />
              <div className="flex-1 sm:mb-4">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">{userData.name}</h1>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 mb-3">
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {userData.location}
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    Joined {userData.joinDate}
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    {userData.stats.averageRating} rating
                  </div>
                </div>
                <p className="text-slate-700 leading-relaxed max-w-2xl">{userData.bio}</p>
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
                  {userData.stats.treksCompleted}
                </div>
                <div className="text-sm text-slate-600">Treks Completed</div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-lg text-center">
                <div className="text-2xl font-bold text-green-600 mb-1">
                  {userData.stats.treksOrganized}
                </div>
                <div className="text-sm text-slate-600">Treks Organized</div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-lg text-center">
                <div className="text-2xl font-bold text-purple-600 mb-1">
                  {userData.stats.totalDistance}
                </div>
                <div className="text-sm text-slate-600">Total Distance</div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-lg text-center">
                <div className="text-2xl font-bold text-yellow-600 mb-1">
                  {userData.stats.averageRating}
                </div>
                <div className="text-sm text-slate-600">Avg. Rating</div>
              </div>
            </div>

            {/* Recent Treks */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">Recent Treks</h2>
              <div className="space-y-4">
                {userData.recentTreks.map((trek) => (
                  <div key={trek.id} className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                    <img
                      src={trek.image}
                      alt={trek.title}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{trek.title}</h3>
                      <p className="text-sm text-slate-600">{trek.date}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          trek.role === 'Organizer' 
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
                {userData.upcomingTreks.map((trek) => (
                  <div key={trek.id} className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                    <img
                      src={trek.image}
                      alt={trek.title}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{trek.title}</h3>
                      <p className="text-sm text-slate-600">{trek.date}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          trek.role === 'Organizer' 
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
                {userData.badges.map((badge, index) => (
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
              <h2 className="text-xl font-semibold text-slate-900 mb-6">This Month</h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Treks Joined</span>
                  <span className="font-semibold text-slate-900">2</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Photos Shared</span>
                  <span className="font-semibold text-slate-900">15</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Reviews Written</span>
                  <span className="font-semibold text-slate-900">3</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Distance Covered</span>
                  <span className="font-semibold text-slate-900">127 km</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

