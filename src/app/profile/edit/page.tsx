'use client';

import React, { useState } from 'react';
import { Camera, Save } from 'lucide-react';

export default function EditProfilePage() {
  const [formData, setFormData] = useState({
    name: 'Alex Doe',
    age: 28,
    gender: 'Male',
    email: 'alex.doe@example.com',
    experience: 'Intermediate',
    bio: 'Passionate about mountains and exploring new trails. Always up for a challenge!',
    favoriteTypes: {
      forest: true,
      mountain: true,
      waterfall: false
    },
    emergencyContact: {
      name: 'Jane Doe',
      relationship: 'Partner',
      phone: '+1234567890'
    },
    privacy: 'joined-treks'
  });

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert('Profile updated successfully!');
  };

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
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=160&h=160&fit=crop&crop=face"
                  alt="Profile"
                  className="w-full h-full rounded-full object-cover"
                />
                <button className="absolute bottom-1 right-1 flex size-10 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors">
                  <Camera className="w-5 h-5" />
                </button>
              </div>
              <button className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-5 bg-slate-200 text-slate-800 text-sm font-bold leading-normal tracking-wide hover:bg-slate-300 transition-colors">
                Upload Photo
              </button>
            </div>

            {/* Form Section */}
            <div className="lg:col-span-2">
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Basic Information */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <label className="flex flex-col">
                    <p className="text-slate-600 text-sm font-medium pb-2">Name</p>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      className="form-input w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                    />
                  </label>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <label className="flex flex-col">
                      <p className="text-slate-600 text-sm font-medium pb-2">Age</p>
                      <input
                        type="number"
                        value={formData.age}
                        onChange={(e) => handleInputChange('age', parseInt(e.target.value))}
                        className="form-input w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 placeholder:text-slate-400"
                      />
                    </label>
                    
                    <label className="flex flex-col">
                      <p className="text-slate-600 text-sm font-medium pb-2">Gender</p>
                      <select
                        value={formData.gender}
                        onChange={(e) => handleInputChange('gender', e.target.value)}
                        className="form-select w-full rounded-xl border-slate-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </label>
                  </div>
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
                    <label className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all ${
                      formData.privacy === 'joined-treks' ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="privacy"
                        value="joined-treks"
                        checked={formData.privacy === 'joined-treks'}
                        onChange={(e) => handleInputChange('privacy', e.target.value)}
                        className="form-radio h-5 w-5 border-slate-300 text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500"
                      />
                      <p className="text-slate-600 text-sm font-medium">
                        Show profile only to joined treks
                      </p>
                    </label>
                    
                    <label className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all ${
                      formData.privacy === 'public' ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="privacy"
                        value="public"
                        checked={formData.privacy === 'public'}
                        onChange={(e) => handleInputChange('privacy', e.target.value)}
                        className="form-radio h-5 w-5 border-slate-300 text-blue-500 checked:bg-blue-500 checked:border-transparent focus:ring-blue-500"
                      />
                      <p className="text-slate-600 text-sm font-medium">Public</p>
                    </label>
                    
                    <label className={`flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all ${
                      formData.privacy === 'private' ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="privacy"
                        value="private"
                        checked={formData.privacy === 'private'}
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
                    className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full h-12 px-6 bg-blue-500 text-white text-base font-bold leading-normal tracking-wide shadow-md hover:bg-blue-600 transition-colors"
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
