'use client';

import React, { useState, useEffect } from 'react';
import { Camera, Save } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function EditProfilePage() {
  const supabase = createClient();
  const { user } = useAuth();

  const defaultFormData = {
    full_name: '',
    age: '',
    gender: '',
    email: '',
    experience_level: '',
    bio: '',
    avatar_url: '',
    favoriteTypes: { forest: false, mountain: false, waterfall: false },
    emergencyContact: { name: '', relationship: '', phone: '' },
    privacy: 'joined-treks',
  };

  const [formData, setFormData] = useState(defaultFormData);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    const fetchProfile = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, age, Gender, email, experience_level, bio, emergency_contact, emergency_no, avatar_url')
        .eq('id', user.id)
        .single();

      if (!error && data) {
        setFormData({
          ...defaultFormData,
          full_name: data.full_name || '',
          age: data.age || '',
          gender: data.Gender || '',
          email: data.email || user.email || '',
          experience_level: data.experience_level || '',
          bio: data.bio || '',
          avatar_url: data.avatar_url || '',
          emergencyContact: {
            name: data.emergency_contact || '',
            relationship: '',
            phone: data.emergency_no || '',
          },
        });
      }
      setLoading(false);
    };
    fetchProfile();
  }, [user]);

  const handleInputChange = (field: string, value: any) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const handleEmergencyContactChange = (field: string, value: string) =>
    setFormData(prev => ({
      ...prev,
      emergencyContact: { ...prev.emergencyContact, [field]: value },
    }));

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const fileExt = file.name.split('.').pop() ?? 'png'; // default to png if no extension
    const fileName = `${user.id}.${fileExt}`;

    // Upload file
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      alert('Upload failed: ' + uploadError.message);
      return;
    }

    // Get public URL
    const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);

    // Update user profile with new avatar URL
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: data.publicUrl })
      .eq('id', user.id);

    if (updateError) {
      alert('Failed to update profile: ' + updateError.message);
      return;
    }

    alert('Photo uploaded successfully!');
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: formData.full_name || null,
      age: formData.age ? Number(formData.age) : null,
      Gender: formData.gender || null,
      email: formData.email || null,
      experience_level: formData.experience_level || null,
      bio: formData.bio || null,
      avatar_url: formData.avatar_url || null,
      emergency_contact: formData.emergencyContact.name || null,
      emergency_no: formData.emergencyContact.phone || null,
    }, { onConflict: 'id' });

    if (error) {
      alert('Could not save profile.');
      return;
    }

    if (formData.email && formData.email !== user.email) {
      await supabase.auth.updateUser({ email: formData.email });
    }
    alert('Profile saved!');
  };

  if (loading) return <p className="text-center text-slate-600 mt-10">Loading...</p>;

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="flex-1 px-4 sm:px-6 lg:px-40 py-10">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-slate-800 text-3xl font-bold mb-8">Edit Profile</h1>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
            <div className="flex flex-col items-center lg:items-start">
              <div className="relative mb-4 size-40 rounded-full bg-slate-300 bg-cover bg-center">
                <img
                  src={formData.avatar_url || 'https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/avatars/image.jpg '}
                  alt="Profile"
                  className="w-full h-full rounded-full object-cover"
                />
                <label
                  htmlFor="photo-upload"
                  className="absolute bottom-1 right-1 flex size-10 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  <Camera className="w-5 h-5" />
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  id="photo-upload"
                />
              </div>
              <label
                htmlFor="photo-upload"
                className="cursor-pointer flex items-center justify-center h-10 px-5 rounded-full bg-slate-200 text-slate-800 text-sm font-bold hover:bg-slate-300 transition-colors"
              >
                Upload Photo
              </label>
            </div>

            <div className="lg:col-span-2">
              <form onSubmit={handleSubmit} className="space-y-8">
                <label className="flex flex-col">
                  <span className="text-slate-600 text-sm font-medium pb-2">Name</span>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={e => handleInputChange('full_name', e.target.value)}
                    className="form-input w-full rounded-xl border-slate-300"
                  />
                </label>

                <div className="grid grid-cols-2 gap-6">
                  <label className="flex flex-col">
                    <span className="text-slate-600 text-sm font-medium pb-2">Age</span>
                    <input
                      type="number"
                      value={formData.age}
                      onChange={e => handleInputChange('age', e.target.value)}
                      className="form-input w-full rounded-xl border-slate-300"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-600 text-sm font-medium pb-2">Gender</span>
                    <select
                      value={formData.gender}
                      onChange={e => handleInputChange('gender', e.target.value)}
                      className="form-select w-full rounded-xl border-slate-300"
                    >
                      <option value="">Select</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                </div>

                <label className="flex flex-col">
                  <span className="text-slate-600 text-sm font-medium pb-2">Email</span>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => handleInputChange('email', e.target.value)}
                    className="form-input w-full rounded-xl border-slate-300"
                  />
                </label>

                <label className="flex flex-col">
                  <span className="text-slate-600 text-sm font-medium pb-2">Experience Level</span>
                  <select
                    value={formData.experience_level}
                    onChange={e => handleInputChange('experience_level', e.target.value)}
                    className="form-select w-full rounded-xl border-slate-300"
                  >
                    <option value="">Select</option>
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Expert">Expert</option>
                  </select>
                </label>

                <label className="flex flex-col">
                  <span className="text-slate-600 text-sm font-medium pb-2">Bio</span>
                  <textarea
                    value={formData.bio}
                    onChange={e => handleInputChange('bio', e.target.value)}
                    rows={4}
                    className="form-textarea w-full rounded-xl border-slate-300"
                  />
                </label>

                <div>
                  <h3 className="text-slate-800 text-base font-bold mb-4">Emergency Contact</h3>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <label className="flex flex-col">
                      <span className="text-slate-600 text-sm font-medium pb-2">Name</span>
                      <input
                        type="text"
                        value={formData.emergencyContact.name}
                        onChange={e => handleEmergencyContactChange('name', e.target.value)}
                        className="form-input w-full rounded-xl border-slate-300"
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-slate-600 text-sm font-medium pb-2">Relationship</span>
                      <input
                        type="text"
                        value={formData.emergencyContact.relationship}
                        onChange={e => handleEmergencyContactChange('relationship', e.target.value)}
                        className="form-input w-full rounded-xl border-slate-300"
                      />
                    </label>
                    <label className="col-span-full flex flex-col">
                      <span className="text-slate-600 text-sm font-medium pb-2">Phone</span>
                      <input
                        type="tel"
                        value={formData.emergencyContact.phone}
                        onChange={e => handleEmergencyContactChange('phone', e.target.value)}
                        className="form-input w-full rounded-xl border-slate-300"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    className="flex items-center gap-2 h-12 px-6 rounded-full bg-blue-500 text-white font-bold hover:bg-blue-600"
                  >
                    <Save className="w-5 h-5" />
                    Save Changes
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

