'use client';

import React, { useState, useEffect } from 'react';
import { Star, MapPin, Calendar, Image as ImageIcon, ThumbsUp, MessageSquare, Send, CheckCircle2, X, Loader2 } from 'lucide-react';
import SnowEffect from '@/components/ui/SnowEffect';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { compressImage, sanitizeFileName } from '@/utils/imageCompression';

interface CompletedTrek {
  user_id: string;
  trek_id: string;
  title: string;
  cover_image_url: string;
  batch_date: string;
  batch_id: string;
}

export default function ReviewPage() {
  const supabase = createClient();
  const { user } = useAuth();
  const [treks, setTreks] = useState<CompletedTrek[]>([]);
  const [selectedTrek, setSelectedTrek] = useState<string | null>(null);
  const [isLoadingTreks, setIsLoadingTreks] = useState(true);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    async function fetchTreks() {
      if (!user) return;

      setIsLoadingTreks(true);
      const { data, error } = await supabase
        .from('user_completed_treks')
        .select('*')
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching treks:', error);
      } else {
        setTreks(data || []);
        if (data && data.length > 0) {
          setSelectedTrek(data[0].trek_id);
        }
      }
      setIsLoadingTreks(false);
    }

    fetchTreks();
  }, [user, supabase]);

  // --- Photo Upload State ---
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Handle Photo Selection
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...filesArray]);

      const newPreviews = filesArray.map((file) => URL.createObjectURL(file));
      setPreviews((prev) => [...prev, ...newPreviews]);
    }
  };

  // Remove Photo from Preview
  const removePhoto = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    URL.revokeObjectURL(previews[index]); // Clean up memory
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedTrek || rating === 0) return;

    setIsUploading(true);
    try {
      // 1. Compress and Upload Photos to 'trek-reviews' bucket
      const photoUrls = await Promise.all(
        selectedFiles.map(async (file) => {
          // Compress image
          const compressedFile = await compressImage(file);

          const sanitizedName = sanitizeFileName(file.name);
          const fileName = `${user.id}/${selectedTrek}/${Date.now()}-${sanitizedName}`;
          const { error } = await supabase.storage.from('trek-reviews').upload(fileName, compressedFile);
          if (error) throw error;
          const { data: { publicUrl } } = supabase.storage.from('trek-reviews').getPublicUrl(fileName);
          return publicUrl;
        })
      );

      // 2. Insert Review into Table
      const selectedTrekData = treks.find(t => t.trek_id === selectedTrek);
      const { error } = await supabase.from('trek_reviews').insert({
        trek_id: selectedTrek,
        user_id: user.id,
        rating,
        comment,
        photo_urls: photoUrls,
        trek_date: selectedTrekData?.batch_date
      });

      if (error) throw error;
      alert('Review posted successfully!');

      // Reset Form
      setComment('');
      setRating(0);
      setSelectedFiles([]);
      setPreviews([]);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-12 relative overflow-hidden text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <SnowEffect />

      <main className="relative z-10 max-w-5xl mx-auto px-4">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[40px] p-8 md:p-12 shadow-2xl">
          <div className="flex flex-col lg:flex-row gap-12">

            {/* Left: Trek Selector */}
            <div className="lg:w-1/3">
              <h2 className="text-3xl font-bold mb-6">Log Your Story</h2>
              <div className="flex flex-row lg:flex-col gap-4 overflow-x-auto lg:overflow-visible pb-4 hide-scrollbar">
                {isLoadingTreks ? (
                  <div className="flex items-center justify-center w-full h-44 lg:h-64 bg-white/5 rounded-2xl animate-pulse">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  </div>
                ) : treks.length > 0 ? (
                  treks.map((trek) => (
                    <button
                      key={trek.batch_id}
                      type="button"
                      onClick={() => setSelectedTrek(trek.trek_id)}
                      className={`shrink-0 w-32 lg:w-full h-44 lg:h-24 rounded-2xl relative overflow-hidden border-2 transition-all ${selectedTrek === trek.trek_id ? 'border-blue-500 scale-105' : 'border-white/10 opacity-50 grayscale'
                        }`}
                    >
                      <img src={trek.cover_image_url} className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40"></div>
                      <div className="absolute bottom-2 left-2 text-left">
                        <p className="text-[10px] font-bold text-white uppercase">{trek.title}</p>
                        <p className="text-[8px] text-blue-300">{new Date(trek.batch_date).toLocaleDateString()}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-gray-400 text-sm italic p-4 bg-white/5 rounded-2xl border border-white/10">
                    No completed treks found.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Review Form */}
            <form onSubmit={handleSubmit} className="flex-1 space-y-6">
              <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                <span className="text-sm font-semibold text-gray-300">Rating</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} onClick={() => setRating(s)} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)}
                      className={`w-6 h-6 cursor-pointer ${(hover || rating) >= s ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'}`} />
                  ))}
                </div>
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-3xl p-6 text-white placeholder-blue-200/30 focus:outline-none focus:border-blue-500/50 min-h-[150px]"
                placeholder="Tell the community about your trek..."
              />

              {/* Photo Preview Component */}
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  {previews.map((src, index) => (
                    <div key={index} className="relative w-20 h-20 group">
                      <img src={src} className="w-full h-full object-cover rounded-xl border border-white/20" />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition shadow-lg"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  <label className="w-20 h-20 rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition group">
                    <ImageIcon className="w-6 h-6 text-gray-500 group-hover:text-blue-400" />
                    <span className="text-[10px] text-gray-500 mt-1">Add</span>
                    <input type="file" multiple className="hidden" onChange={handlePhotoSelect} />
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={isUploading}
                className="w-full bg-white text-black py-4 rounded-full font-bold hover:bg-blue-500 hover:text-white transition flex items-center justify-center gap-2"
              >
                {isUploading ? <Loader2 className="animate-spin w-5 h-5" /> : <Send className="w-4 h-4" />}
                {isUploading ? 'Uploading...' : 'Post Review'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}