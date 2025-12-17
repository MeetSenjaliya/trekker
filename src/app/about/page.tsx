import React from 'react';
import Link from 'next/link';
import { Plus, MessageCircle, CheckCircle } from 'lucide-react';
import SnowEffect from '@/components/ui/SnowEffect';

export default function AboutPage() {
  return (
    // Main Container with Night Gradient
    <div className="min-h-screen py-12 relative overflow-hidden text-white" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>

      {/* Snow Effect Component */}
      <SnowEffect />

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <section className="py-16 md:py-24">
          <div className="max-w-4xl mx-auto">
            {/* Hero Section */}
            <div className="text-center mb-12">
              <h1 className="text-white text-4xl md:text-5xl font-extrabold leading-tight tracking-tight drop-shadow-md">
                About Trek Buddies
              </h1>
              <p className="mt-4 text-lg text-blue-100/80 font-light">
                Your trusted community for unforgettable adventures.
              </p>
            </div>

            <div className="space-y-16">
              {/* Our Story Section */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-2xl">
                <h2 className="text-3xl font-bold text-white mb-6 border-l-4 border-blue-500 pl-4">
                  Our Story
                </h2>
                <p className="text-gray-300 leading-relaxed text-lg">
                  Trek Buddies was born from a shared passion for the great outdoors. We are a group of avid hikers,
                  climbers, and explorers who believe that the best adventures are those shared with others. We found
                  ourselves wanting a simple, reliable platform to connect with like-minded individuals for everything
                  from a casual weekend hike to a challenging multi-day trek. When we couldn't find one that met our
                  needs for safety, community, and ease of use, we decided to build it ourselves. Our mission is to
                  make it easier for everyone to experience the joy of trekking by fostering a supportive and
                  trustworthy community.
                </p>
              </div>

              {/* How It Works Section */}
              <div>
                <h2 className="text-3xl font-bold text-white mb-8 text-center">
                  How It Works
                </h2>
                <div className="grid md:grid-cols-3 gap-8 text-center">
                  <div className="flex flex-col items-center group bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-center size-16 bg-blue-500/20 text-blue-400 rounded-full mb-4 group-hover:bg-blue-500 group-hover:text-white transition-all duration-300 transform group-hover:scale-110">
                      <Plus className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                      1. Create or Discover
                    </h3>
                    <p className="text-gray-400">
                      Organizers can post their trek plans with all the details. Trekkers can browse and find
                      adventures that match their interests and skill level.
                    </p>
                  </div>

                  <div className="flex flex-col items-center group bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-center size-16 bg-blue-500/20 text-blue-400 rounded-full mb-4 group-hover:bg-blue-500 group-hover:text-white transition-all duration-300 transform group-hover:scale-110">
                      <MessageCircle className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                      2. Connect with the Team
                    </h3>
                    <p className="text-gray-400">
                      Join a trek&apos;s group chat to discuss plans, ask questions, and get to know your fellow
                      adventurers before you even hit the trail.
                    </p>
                  </div>

                  <div className="flex flex-col items-center group bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-center size-16 bg-blue-500/20 text-blue-400 rounded-full mb-4 group-hover:bg-blue-500 group-hover:text-white transition-all duration-300 transform group-hover:scale-110">
                      <CheckCircle className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                      3. Prepare & Go!
                    </h3>
                    <p className="text-gray-400">
                      Once everything is set, pack your bags, meet your new friends, and embark on an
                      unforgettable journey together.
                    </p>
                  </div>
                </div>
              </div>

              {/* Safety First Section */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-2xl">
                <h2 className="text-3xl font-bold text-white mb-6 text-center">
                  Safety First: Our Commitment
                </h2>
                <div className="grid md:grid-cols-2 gap-6 text-gray-300 leading-relaxed">
                  <p>
                    Your safety is our top priority. We encourage all members to follow best practices for
                    outdoor adventures. This includes thorough preparation, carrying essential gear, and being
                    aware of your physical limits.
                  </p>
                  <ul className="list-disc list-inside space-y-2">
                    <li>Always research your route and weather conditions.</li>
                    <li>Inform someone of your plans.</li>
                    <li>Carry a first-aid kit and know how to use it.</li>
                    <li>Never trek alone in unfamiliar territory.</li>
                    <li>Respect wildlife and the environment.</li>
                  </ul>
                </div>
              </div>

              {/* Organizer Responsibilities Section */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-2xl">
                <h2 className="text-3xl font-bold text-white mb-6 border-l-4 border-blue-500 pl-4">
                  Organizer Responsibilities
                </h2>
                <p className="text-gray-300 leading-relaxed mb-4">
                  Trek Organizers are the backbone of our community. To ensure every trek is safe and enjoyable,
                  we ask organizers to be clear, communicative, and responsible.
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-400">
                  <li>Provide accurate and detailed trek information (difficulty, distance, gear required).</li>
                  <li>Facilitate pre-trek communication to ensure everyone is prepared.</li>
                  <li>Promote a &apos;leave no trace&apos; ethos.</li>
                  <li>Have a clear plan for emergencies.</li>
                  <li>Assess the group's overall fitness and experience level.</li>
                </ul>
              </div>

              {/* Community Guidelines Section */}
              <div>
                <h2 className="text-3xl font-bold text-white mb-6 text-center">
                  Community Guidelines
                </h2>
                <p className="text-center text-gray-400 max-w-2xl mx-auto mb-8">
                  To maintain a respectful, safe, and enjoyable environment for everyone, we ask all members
                  of the Trek Buddies community to adhere to the following principles:
                </p>
                <div className="grid md:grid-cols-3 gap-8">
                  <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl hover:bg-white/10 transition-colors">
                    <h3 className="text-xl font-semibold text-white mb-3">
                      Be Respectful
                    </h3>
                    <p className="text-gray-400">
                      Treat fellow trekkers, organizers, and the natural environment with kindness and
                      consideration. We have a zero-tolerance policy for harassment or discrimination.
                    </p>
                  </div>
                  <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl hover:bg-white/10 transition-colors">
                    <h3 className="text-xl font-semibold text-white mb-3">
                      Be Honest
                    </h3>
                    <p className="text-gray-400">
                      Be transparent about your trekking experience and physical fitness. Organizers should
                      provide clear and accurate details about the trek.
                    </p>
                  </div>
                  <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl hover:bg-white/10 transition-colors">
                    <h3 className="text-xl font-semibold text-white mb-3">
                      Be Reliable
                    </h3>
                    <p className="text-gray-400">
                      If you commit to a trek, show up prepared and on time. If your plans change, communicate
                      promptly with your organizer and group.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Call to Action */}
            <div className="text-center mt-16">
              <p className="text-xl text-blue-100/80 mb-6">
                Ready to find your next adventure?
              </p>
              <Link
                href="/explore"
                className="inline-flex items-center justify-center px-8 py-3 bg-blue-500 text-white text-base font-semibold rounded-lg hover:bg-blue-600 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                <span>Explore Treks</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

