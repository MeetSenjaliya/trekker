'use client';

import React, { useState, useEffect } from 'react';
import { Camera, Save, Loader2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function EditProfilePage() {
  const supabase = createClient();
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (!user) return;

    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error) throw error;

        if (data) {
          // Parse favorite trek types from array to object
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
              name: data.emergency_contact_name || '',
              relationship: data.emergency_contact_relationship || '',
              phone: data.emergency_contact_phone || ''
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
  }, [user, supabase]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
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
      emergencyContact: {
        ...prev.emergencyContact,
        [field]: value
      }
    }));
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return;
    }
    const file = e.target.files[0];
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      let currentAvatarUrl = avatarUrl;

      // Upload new avatar if selected
      if (avatarFile) {
        const fileExt = avatarFile.name.split('.').pop();
        // Use consistent filename to avoid filling storage
        const fileName = `${user.id}.${fileExt}`;

        const { error: uploadError, data } = await supabase.storage
          .from('avatars') // Changed from 'trek-profile' to 'avatars'
          .upload(fileName, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(fileName);

        currentAvatarUrl = publicUrl;
      }

      // Convert favorite types object back to array
      const favoriteTrekTypes = Object.entries(formData.favoriteTypes)
        .filter(([_, isSelected]) => isSelected)
        .map(([type]) => type.charAt(0).toUpperCase() + type.slice(1)); // Capitalize

      const updates = {
        id: user.id,
        full_name: formData.name,
        email: formData.email,
        experience_level: formData.experience,
        bio: formData.bio,
        favorite_trek_types: favoriteTrekTypes,
        emergency_contact_name: formData.emergencyContact.name,
        emergency_contact_relationship: formData.emergencyContact.relationship,
        emergency_contact_phone: formData.emergencyContact.phone,
        privacy_setting: formData.privacy,
        avatar_url: currentAvatarUrl,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('profiles')
        .upsert(updates);

      if (error) throw error;

      alert('Profile updated successfully!');
      router.push('/x'); // Redirect to profile page
      router.refresh();
    } catch (error: any) {
      console.error('Error updating profile:', error);
      // Log detailed error properties if available
      if (typeof error === 'object' && error !== null) {
        console.error('Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: JSON.stringify(error, null, 2)
        });
      }
      alert(`Error updating profile: ${error.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="flex-1 px-4 sm:px-6 lg:px-40 py-10">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="text-slate-800 text-3xl font-bold leading-tight tracking-tight">
              Edit Profile
            </h1>
          </div>

          <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
            {/* Profile Picture Section */}
            <div className="flex flex-col items-center lg:items-start">
              <div className="relative mb-4 size-40 rounded-full bg-cover bg-center bg-slate-300">
                <img
                  src={avatarPreview || avatarUrl || "https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/avatars/image.jpg"}
                  alt="Profile"
                  className="w-full h-full rounded-full object-cover"
                />
                <label className="absolute bottom-1 right-1 flex size-10 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 cursor-pointer transition-colors">
                  <Camera className="w-5 h-5" />
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handlePhotoSelect}
                  />
                </label>
              </div>
              <label className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-5 bg-slate-200 text-slate-800 text-sm font-bold leading-normal tracking-wide hover:bg-slate-300 transition-colors">
                Upload Photo
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                />
              </label>
            </div>

            {/* Form Section */}
            <div className="lg:col-span-2">
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Basic Information */}
                <div className="grid grid-cols-1 gap-6">
                  <label className="flex flex-col">
                    <p className="text-slate-600 text-sm font-medium pb-2">Name</p>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      className="form-input w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                    />
                  </label>

                  {/* Removed Age and Gender as they are not in the current schema */}
                </div>

                {/* Contact Information */}
                <label className="flex flex-col">
                  <p className="text-slate-600 text-sm font-medium pb-2">Contact Information</p>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className="form-input w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                  />
                </label>

                {/* Experience Level */}
                <label className="flex flex-col">
                  <p className="text-slate-600 text-sm font-medium pb-2">Trekking Experience Level</p>
                  <select
                    value={formData.experience}
                    onChange={(e) => handleInputChange('experience', e.target.value)}
                    className="form-select w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Expert">Expert</option>
                  </select>
                </label>

                {/* Bio */}
                <label className="flex flex-col">
                  <p className="text-slate-600 text-sm font-medium pb-2">Bio</p>
                  <textarea
                    value={formData.bio}
                    onChange={(e) => handleInputChange('bio', e.target.value)}
                    rows={4}
                    className="form-textarea w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                  />
                </label>

                {/* Favorite Trek Types */}
                <div>
                  <h3 className="text-slate-800 text-base font-bold leading-tight mb-4">
                    Favorite Trek Types
                  </h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <label className="flex items-center gap-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.favoriteTypes.forest}
                        onChange={() => handleFavoriteTypeChange('forest')}
                        className="form-checkbox h-5 w-5 rounded border-slate-300 bg-white text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <p className="text-slate-600 text-sm font-medium">Forest</p>
                    </label>

                    <label className="flex items-center gap-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.favoriteTypes.mountain}
                        onChange={() => handleFavoriteTypeChange('mountain')}
                        className="form-checkbox h-5 w-5 rounded border-slate-300 bg-white text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <p className="text-slate-600 text-sm font-medium">Mountain</p>
                    </label>

                    <label className="flex items-center gap-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.favoriteTypes.waterfall}
                        onChange={() => handleFavoriteTypeChange('waterfall')}
                        className="form-checkbox h-5 w-5 rounded border-slate-300 bg-white text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <p className="text-slate-600 text-sm font-medium">Waterfall</p>
                    </label>
                  </div>
                </div>

                {/* Emergency Contact */}
                <div>
                  <h3 className="text-slate-800 text-base font-bold leading-tight mb-4">
                    Emergency Contact
                  </h3>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <label className="flex flex-col">
                      <p className="text-slate-600 text-sm font-medium pb-2">Name</p>
                      <input
                        type="text"
                        value={formData.emergencyContact.name}
                        onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                        className="form-input w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                      />
                    </label>

                    <label className="flex flex-col">
                      <p className="text-slate-600 text-sm font-medium pb-2">Relationship</p>
                      <input
                        type="text"
                        value={formData.emergencyContact.relationship}
                        onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                        className="form-input w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                      />
                    </label>

                    <label className="col-span-full flex flex-col">
                      <p className="text-slate-600 text-sm font-medium pb-2">Contact Information</p>
                      <input
                        type="tel"
                        value={formData.emergencyContact.phone}
                        onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                        className="form-input w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                      />
                    </label>
                  </div>
                </div>

                {/* Privacy Settings */}
                <div>
                  <h3 className="text-slate-800 text-base font-bold leading-tight mb-4">
                    Privacy Settings
                  </h3>
                  <div className="space-y-4">
                    <label className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all ${formData.privacy === 'Joined Treks Only' ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
                      }`}>
                      <input
                        type="radio"
                        name="privacy"
                        value="Joined Treks Only"
                        checked={formData.privacy === 'Joined Treks Only'}
                        onChange={(e) => handleInputChange('privacy', e.target.value)}
                        className="form-radio h-5 w-5 border-slate-300 text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500"
                      />
                      <p className="text-slate-600 text-sm font-medium">
                        Show profile only to joined treks
                      </p>
                    </label>

                    <label className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all ${formData.privacy === 'Public' ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
                      }`}>
                      <input
                        type="radio"
                        name="privacy"
                        value="Public"
                        checked={formData.privacy === 'Public'}
                        onChange={(e) => handleInputChange('privacy', e.target.value)}
                        className="form-radio h-5 w-5 border-slate-300 text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500"
                      />
                      <p className="text-slate-600 text-sm font-medium">Public</p>
                    </label>

                    <label className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all ${formData.privacy === 'Private' ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
                      }`}>
                      <input
                        type="radio"
                        name="privacy"
                        value="Private"
                        checked={formData.privacy === 'Private'}
                        onChange={(e) => handleInputChange('privacy', e.target.value)}
                        className="form-radio h-5 w-5 border-slate-300 text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500"
                      />
                      <p className="text-slate-600 text-sm font-medium">Private</p>
                    </label>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full h-12 px-6 bg-blue-500 text-white text-base font-bold leading-normal tracking-wide shadow-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Save className="w-5 h-5" />
                    )}
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
