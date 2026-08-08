import React from 'react';
import ReviewForm from '@/components/ui/ReviewForm';
import { Star, ThumbsUp } from 'lucide-react';

// Sample review data
const pastReviews = [
  {
    id: '1',
    user: {
      name: 'Ethan Carter',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=256&q=80',
      joinDate: '2 months ago'
    },
    rating: 5,
    review: 'The trek was absolutely breathtaking! The views were stunning, and the guide was incredibly knowledgeable. I highly recommend this trek to anyone looking for an adventure. The food was great too!',
    helpful: 15,
    trekTitle: 'Himalayan Heights'
  },
  {
    id: '2',
    user: {
      name: 'Sarah Johnson',
      avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?ixlib=rb-4.0.3&auto=format&fit=crop&w=256&q=80',
      joinDate: '1 month ago'
    },
    rating: 4,
    review: 'Great experience overall! The trek was challenging but rewarding. The group was fantastic and the organizer was very professional. Would definitely join another trek with this team.',
    helpful: 8,
    trekTitle: 'Alps Ascent'
  },
  {
    id: '3',
    user: {
      name: 'Mike Thompson',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-4.0.3&auto=format&fit=crop&w=256&q=80',
      joinDate: '3 weeks ago'
    },
    rating: 5,
    review: 'Incredible adventure! The scenery was beyond words and the camaraderie among the group made it even more special. Highly recommend for anyone seeking an authentic trekking experience.',
    helpful: 12,
    trekTitle: 'Andes Adventure'
  }
];

const overallStats = {
  averageRating: 4.5,
  totalReviews: 120,
  ratingDistribution: [
    { stars: 5, percentage: 40 },
    { stars: 4, percentage: 30 },
    { stars: 3, percentage: 15 },
    { stars: 2, percentage: 10 },
    { stars: 1, percentage: 5 }
  ]
};

export default function ReviewPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Overall Rating Section */}
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Overall Score */}
            <div className="text-center md:text-left">
              <div className="flex flex-col md:flex-row items-center md:items-start gap-4">
                <div>
                  <p className="text-5xl font-black text-slate-800 leading-tight">
                    {overallStats.averageRating}
                  </p>
                  <div className="flex gap-1 text-yellow-400 justify-center md:justify-start mt-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-5 h-5 ${
                          star <= Math.floor(overallStats.averageRating)
                            ? 'fill-yellow-400'
                            : star <= overallStats.averageRating
                            ? 'fill-yellow-400 opacity-50'
                            : 'fill-slate-300'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-slate-700 text-sm font-medium mt-2">
                    Based on {overallStats.totalReviews} reviews
                  </p>
                </div>
              </div>
            </div>

            {/* Rating Distribution */}
            <div className="space-y-2">
              {overallStats.ratingDistribution.map((rating) => (
                <div key={rating.stars} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700 w-12">
                    {rating.stars} stars
                  </span>
                  <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${rating.percentage}%` }}
                    />
                  </div>
                  <span className="text-sm text-slate-500 w-8 text-right">
                    {rating.percentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Review Form */}
        <ReviewForm trekTitle="The Everest Base Camp" />

        {/* Past Reviews Section */}
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg mt-8">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-6">
            Past Experiences from Fellow Trekkers
          </h2>
          
          <div className="space-y-8">
            {pastReviews.map((review) => (
              <div
                key={review.id}
                className="border-b border-slate-200 pb-6 last:border-b-0 last:pb-0"
              >
                {/* Review Header */}
                <div className="flex items-start gap-4 mb-4">
                  <img
                    src={review.user.avatar}
                    alt={review.user.name}
                    className="w-12 h-12 rounded-full border border-slate-200"
                  />
                  <div className="flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-800">{review.user.name}</p>
                        <p className="text-sm text-slate-500">Posted {review.user.joinDate}</p>
                      </div>
                      <div className="text-sm text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                        {review.trekTitle}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rating */}
                <div className="flex gap-1 text-yellow-400 mb-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-4 h-4 ${
                        star <= review.rating ? 'fill-yellow-400' : 'fill-slate-300'
                      }`}
                    />
                  ))}
                </div>

                {/* Review Text */}
                <p className="text-slate-700 text-base leading-relaxed mb-4">
                  {review.review}
                </p>

                {/* Actions */}
                <div className="flex items-center gap-4 text-slate-500">
                  <button className="flex items-center gap-2 hover:text-blue-600 transition-colors group">
                    <ThumbsUp className="w-4 h-4 group-hover:text-blue-600" />
                    <span className="text-sm font-medium">Helpful ({review.helpful})</span>
                  </button>
                  <button className="text-sm font-medium hover:text-blue-600 transition-colors">
                    Reply
                  </button>
                  <button className="text-sm font-medium hover:text-blue-600 transition-colors">
                    Share
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Load More Reviews */}
          <div className="text-center mt-8">
            <button className="inline-flex items-center justify-center px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition-colors">
              Load More Reviews
            </button>
          </div>
        </div>

        {/* Review Guidelines */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mt-8">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">Review Guidelines</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex items-start">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              Be honest and constructive in your feedback
            </li>
            <li className="flex items-start">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              Focus on your personal experience and specific details
            </li>
            <li className="flex items-start">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              Respect other trekkers and organizers in your comments
            </li>
            <li className="flex items-start">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              Include photos to help others visualize the experience
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}