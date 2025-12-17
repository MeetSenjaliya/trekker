'use client';

import React, { useState, useEffect } from 'react';
import { Camera, Save, Loader2, User, Mail, Phone, Heart, Shield, AlertTriangle } from 'lucide-react';
import SnowEffect from '@/components/ui/SnowEffect';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function EditProfilePage() {
  const [supabase] = useState(() => createClient());
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    experience: 'Intermediate',
    bio: '',
    favoriteTypes: {
      forest: false,
      mountain: false,
      waterfall: false
    },
    emergencyContact: {
      name: '',
      relationship: '',
      phone: ''
    },
    privacy: 'Public'
  });

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // --- Fetch Profile Data ---
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;

    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (data) {
          const favorites = {
            forest: data.favorite_trek_types?.includes('Forest') || false,
            mountain: data.favorite_trek_types?.includes('Mountain') || false,
            waterfall: data.favorite_trek_types?.includes('Waterfall') || false,
          };

          setFormData({
            name: data.full_name || '',
            email: data.email || user.email || '',
            experience: data.experience_level || 'Intermediate',
            bio: data.bio || '',
            favoriteTypes: favorites,
            emergencyContact: {
              name: data.emergency_contact || '',
              relationship: '', // Assuming relationship is stored or defaults to empty
              phone: data.emergency_no || ''
            },
            privacy: data.privacy_setting || 'Public'
          });
          setAvatarUrl(data.avatar_url);
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [user, supabase, authLoading]);

  // --- Handlers ---
  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFavoriteTypeChange = (type: string) => {
    setFormData(prev => ({
      ...prev,
      favoriteTypes: {
        ...prev.favoriteTypes,
        [type]: !prev.favoriteTypes[type as keyof typeof prev.favoriteTypes]
      }
    }));
  };

  const handleEmergencyContactChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      emergencyContact: { ...prev.emergencyContact, [field]: value }
    }));
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    try {
      let currentAvatarUrl = avatarUrl;

      // Upload Avatar Logic
      if (avatarFile) {
        setUploading(true);
        const fileExt = avatarFile.name.split('.').pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(fileName);
          
        currentAvatarUrl = publicUrl;
        setUploading(false);
      }

      // Convert Favorites to Array
      const favoriteTrekTypes = Object.entries(formData.favoriteTypes)
        .filter(([_, isSelected]) => isSelected)
        .map(([type]) => type.charAt(0).toUpperCase() + type.slice(1));

      // Update Profile
      const updates = {
        id: user.id,
        full_name: formData.name,
        email: formData.email,
        experience_level: formData.experience,
        bio: formData.bio,
        emergency_contact: formData.emergencyContact.name,
        emergency_no: formData.emergencyContact.phone,
        // privacy_setting: formData.privacy, // Uncomment if schema supports it
        // favorite_trek_types: favoriteTrekTypes, // Uncomment if schema supports it
        avatar_url: currentAvatarUrl,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('profiles').upsert(updates);
      if (error) throw error;

      alert('Profile updated successfully!');
      router.push('/profile');
      router.refresh();
    } catch (error: any) {
      alert(`Error updating profile: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen relative flex items-center justify-center bg-[#090a0f]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  // --- Styles ---
  // Input style that looks carved into the glass
  const inputClass = "w-full pl-10 pr-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all";
  
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center py-12 px-4" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <SnowEffect />

      {/* Main Card Container */}
      <div className="relative z-10 w-full max-w-2xl bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
        
        {/* Decorative Header Banner */}
        <div className="h-32 bg-gradient-to-r from-blue-600 to-purple-600 relative">
          <div className="absolute inset-0 bg-black/10"></div>
        </div>

        <div className="px-8 pb-8">
          {/* Avatar Section (Overlapping Header) */}
          <div className="relative -mt-16 mb-8 text-center">
            <div className="relative inline-block group">
              <div className="w-32 h-32 rounded-full p-1 bg-[#1b2735]">
                <img 
                  src={avatarPreview || avatarUrl || "https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/avatars/image.jpg"} 
                  alt="Profile" 
                  className={`w-full h-full rounded-full object-cover ${uploading ? 'opacity-50' : ''}`}
                />
              </div>
              <label className="absolute bottom-1 right-1 bg-blue-500 p-2.5 rounded-full border-4 border-[#1b2735] text-white hover:bg-blue-600 cursor-pointer transition-colors shadow-lg">
                <Camera className="w-4 h-4" />
                <input type="file" className="hidden" accept="image/*" onChange={handlePhotoSelect} disabled={saving} />
              </label>
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-white drop-shadow-md" />
                </div>
              )}
            </div>
            <h2 className="text-2xl font-bold text-white mt-3">Edit Profile</h2>
            <p className="text-blue-200/60 text-sm">Update your personal details</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            
            {/* Section: Basic Info */}
            <div className="space-y-4">
              <div className="relative">
                <User className="absolute left-3.5 top-3.5 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className={inputClass}
                />
              </div>
              
              <div className="relative">
                <Mail className="absolute left-3.5 top-3.5 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="relative">
                 {/* Experience Select */}
                 <div className="absolute left-3.5 top-3.5 w-5 h-5 text-gray-400 flex items-center justify-center font-bold text-xs border border-gray-400 rounded px-1">XP</div>
                 <select
                    value={formData.experience}
                    onChange={(e) => handleInputChange('experience', e.target.value)}
                    className={`${inputClass} appearance-none cursor-pointer [&>option]:bg-[#1b2735]`}
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Expert">Expert</option>
                  </select>
              </div>

              <div className="relative">
                <textarea
                  rows={3}
                  placeholder="Tell us about yourself..."
                  value={formData.bio}
                  onChange={(e) => handleInputChange('bio', e.target.value)}
                  className={`${inputClass} pl-4 resize-none`}
                />
              </div>
            </div>

            {/* Section: Favorite Trek Types */}
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
               <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                 <Heart className="w-4 h-4" /> Favorite Terrains
               </h3>
               <div className="flex flex-wrap gap-3">
                  {['forest', 'mountain', 'waterfall'].map((type) => (
                    <label key={type} className="cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="peer sr-only"
                        checked={formData.favoriteTypes[type as keyof typeof formData.favoriteTypes]}
                        onChange={() => handleFavoriteTypeChange(type)}
                      />
                      <div className="px-4 py-2 rounded-lg bg-black/20 border border-white/10 text-gray-400 peer-checked:bg-blue-500/20 peer-checked:border-blue-500/50 peer-checked:text-blue-300 transition-all text-sm capitalize group-hover:bg-white/5">
                        {type}
                      </div>
                    </label>
                  ))}
               </div>
            </div>

            {/* Section: Emergency Contact */}
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                 <AlertTriangle className="w-4 h-4 text-red-400" /> Emergency Contact
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <input
                    type="text"
                    placeholder="Contact Name"
                    value={formData.emergencyContact.name}
                    onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg bg-black/20 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-red-400/50 transition-all text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Relationship"
                    value={formData.emergencyContact.relationship}
                    onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg bg-black/20 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-red-400/50 transition-all text-sm"
                  />
                  <div className="col-span-1 md:col-span-2 relative">
                     <Phone className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
                     <input
                        type="tel"
                        placeholder="Emergency Phone Number"
                        value={formData.emergencyContact.phone}
                        onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-black/20 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-red-400/50 transition-all text-sm"
                      />
                  </div>
              </div>
            </div>

            {/* Section: Privacy Settings */}
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
               <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                 <Shield className="w-4 h-4 text-emerald-400" /> Privacy Settings
               </h3>
               
               <div className="space-y-2">
                 {[
                   { val: 'Joined Treks Only', label: 'Show profile only to joined treks' },
                   { val: 'Public', label: 'Public (Visible to everyone)' },
                   { val: 'Private', label: 'Private (Only me)' }
                 ].map((option) => (
                   <label key={option.val} className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                     formData.privacy === option.val 
                       ? 'bg-blue-500/10 border-blue-500/30' 
                       : 'bg-black/20 border-white/5 hover:bg-white/5'
                   }`}>
                      <span className={`text-sm ${formData.privacy === option.val ? 'text-blue-200' : 'text-gray-400'}`}>
                        {option.label}
                      </span>
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        formData.privacy === option.val ? 'border-blue-400' : 'border-gray-500'
                      }`}>
                        {formData.privacy === option.val && <div className="w-2.5 h-2.5 bg-blue-400 rounded-full" />}
                      </div>
                      <input 
                        type="radio" 
                        name="privacy" 
                        value={option.val} 
                        checked={formData.privacy === option.val}
                        onChange={(e) => handleInputChange('privacy', e.target.value)}
                        className="hidden"
                      />
                   </label>
                 ))}
               </div>
            </div>

            {/* Save Button */}
            <button
              type="submit"
              disabled={saving}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 transform transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {saving ? 'Saving Changes...' : 'Save Changes'}
            </button>

          </form>
        </div>
      </div>
    </div>
  );
}