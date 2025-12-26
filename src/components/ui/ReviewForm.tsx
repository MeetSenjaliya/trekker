'use client';

import React, { useState, useEffect } from 'react';
import { Star, Upload, X } from 'lucide-react';
import { compressImage } from '@/utils/imageCompression';

interface ReviewFormProps {
  trekTitle?: string;
  onSubmit?: (reviewData: ReviewData) => void;
}

interface ReviewData {
  rating: number;
  review: string;
  photos: File[];
}

const ReviewForm: React.FC<ReviewFormProps> = ({
  trekTitle = "Your Trek Experience",
  onSubmit
}) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [review, setReview] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStarClick = (starValue: number) => {
    setRating(starValue);
  };

  const handleStarHover = (starValue: number) => {
    setHoverRating(starValue);
  };

  const handleStarLeave = () => {
    setHoverRating(0);
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (photos.length + files.length > 5) {
      alert('You can upload a maximum of 5 photos.');
      return;
    }

    setIsSubmitting(true); // Show a loading state while compressing
    try {
      const compressedFiles = await Promise.all(
        files.map(async (file) => {
          if (file.type.startsWith('image/')) {
            return await compressImage(file);
          }
          return file;
        })
      );

      const validFiles = compressedFiles.filter(file => {
        const isValidType = file.type.startsWith('image/');
        const isValidSize = file.size <= 2 * 1024 * 1024; // 2MB
        return isValidType && isValidSize;
      });

      setPhotos(prev => [...prev, ...validFiles]);
    } catch (error) {
      console.error('Error processing photos:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (rating === 0) {
      alert('Please provide a rating.');
      return;
    }

    if (review.trim().length < 10) {
      alert('Please write a review with at least 10 characters.');
      return;
    }

    setIsSubmitting(true);

    const reviewData: ReviewData = {
      rating,
      review: review.trim(),
      photos
    };

    try {
      onSubmit?.(reviewData);
      // Reset form
      setRating(0);
      setReview('');
      setPhotos([]);
      alert('Review submitted successfully!');
    } catch (_error) {
      alert('Failed to submit review. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayRating = hoverRating || rating;

  return (
    <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">
          Review Your Trek: {trekTitle}
        </h1>
        <p className="text-slate-600 text-base">
          Your feedback is valuable! Share your experience to help fellow trekkers plan their adventures.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Rating Section */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-3">
            Your Rating
          </label>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((starValue) => (
                <button
                  key={starValue}
                  type="button"
                  onClick={() => handleStarClick(starValue)}
                  onMouseEnter={() => handleStarHover(starValue)}
                  onMouseLeave={handleStarLeave}
                  className="text-3xl transition-colors duration-200 hover:scale-110 transform"
                >
                  <Star
                    className={`w-8 h-8 ${starValue <= displayRating
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-gray-300'
                      }`}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <span className="ml-3 text-sm text-slate-600">
                {rating} out of 5 stars
              </span>
            )}
          </div>
        </div>

        {/* Review Text */}
        <div>
          <label htmlFor="review" className="block text-sm font-semibold text-slate-700 mb-2">
            Your Review
          </label>
          <textarea
            id="review"
            value={review}
            onChange={(e) => setReview(e.target.value)}
            placeholder="Share details of your own experience on this trek... What did you enjoy most? Any tips for future trekkers?"
            rows={6}
            className="w-full rounded-lg border-slate-300 bg-white focus:border-blue-500 focus:ring focus:ring-blue-500 focus:ring-opacity-50 placeholder:text-slate-400 p-4 text-base resize-none transition-colors"
            required
          />
          <div className="mt-1 text-sm text-slate-500">
            {review.length}/500 characters (minimum 10 required)
          </div>
        </div>

        {/* Photo Upload */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Upload Photos (Optional)
          </label>

          {/* Upload Area */}
          <div className="relative">
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handlePhotoUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={photos.length >= 5}
            />
            <div className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${photos.length >= 5
              ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
              : 'border-slate-300 hover:border-blue-400 cursor-pointer group'
              }`}>
              <Upload className={`w-12 h-12 transition-colors ${photos.length >= 5
                ? 'text-gray-400'
                : 'text-slate-400 group-hover:text-blue-500'
                }`} />
              <div className="text-center">
                <p className={`text-base font-semibold transition-colors ${photos.length >= 5
                  ? 'text-gray-500'
                  : 'text-slate-700 group-hover:text-blue-600'
                  }`}>
                  {photos.length >= 5 ? 'Maximum photos reached' : 'Drag and drop photos here'}
                </p>
                <p className="text-slate-500 text-sm mt-1">
                  Or click to browse (Max. 5 photos, 2MB each)
                </p>
              </div>
            </div>
          </div>

          {/* Photo Preview */}
          {photos.length > 0 && (
            <div className="mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {photos.map((photo, index) => {
                  const previewUrl = URL.createObjectURL(photo);
                  return (
                    <div key={index} className="relative group">
                      <img
                        src={previewUrl}
                        alt={`Upload preview ${index + 1}`}
                        className="w-full h-24 object-cover rounded-lg border border-gray-200"
                        onLoad={() => URL.revokeObjectURL(previewUrl)} // Optional: revoke after load if not needed for long
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSubmitting || rating === 0 || review.trim().length < 10}
            className="px-8 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-all duration-200 min-w-[120px]"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ReviewForm;

