import React from 'react';
import Link from 'next/link';

const DEFAULT_IMAGE = 'https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/trek-profile/River%20Valley%20Trek.jpeg';


const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${DEFAULT_IMAGE})`
        }}
      />

      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white leading-tight tracking-tight mb-6">
          Explore the World, <span className="text-blue-400">One Trek at a Time</span>
        </h1>

        <p className="text-slate-200 text-base sm:text-lg md:text-xl font-light leading-relaxed mb-10 max-w-3xl mx-auto">
          Join our community of passionate trekkers and discover breathtaking landscapes,
          forge lasting friendships, and create unforgettable memories on adventures around the globe.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link
            href="/explore"
            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 bg-blue-500 hover:bg-blue-600 text-white text-base font-semibold rounded-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 min-w-[200px]"
          >
            Start a New Trek
          </Link>

          <Link
            href="/explore"
            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-base font-semibold rounded-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 min-w-[200px]"
          >
            Join an Existing Trek
          </Link>
        </div>

        {/* Stats Section */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
            <div className="text-3xl font-bold text-white mb-2">500+</div>
            <div className="text-slate-200 text-sm">Active Trekkers</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
            <div className="text-3xl font-bold text-white mb-2">150+</div>
            <div className="text-slate-200 text-sm">Treks Completed</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
            <div className="text-3xl font-bold text-white mb-2">25+</div>
            <div className="text-slate-200 text-sm">Countries Explored</div>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 border-2 border-white/50 rounded-full flex justify-center">
          <div className="w-1 h-3 bg-white/50 rounded-full mt-2 animate-pulse"></div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;