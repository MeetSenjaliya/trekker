import React from 'react';
import Link from 'next/link';
import { Plus, MessageCircle, CheckCircle } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="flex-1">
        <section className="bg-white py-16 md:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Hero Section */}
            <div className="text-center mb-12">
              <h1 className="text-slate-900 text-4xl md:text-5xl font-extrabold leading-tight tracking-tight">
                About Trek Buddies
              </h1>
              <p className="mt-4 text-lg text-slate-600">
                Your trusted community for unforgettable adventures.
              </p>
            </div>

            <div className="space-y-16">
              {/* Our Story Section */}
              <div>
                <h2 className="text-3xl font-bold text-slate-800 mb-6 border-l-4 border-blue-500 pl-4">
                  Our Story
                </h2>
                <p className="text-slate-600 leading-relaxed">
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
                <h2 className="text-3xl font-bold text-slate-800 mb-8 text-center">
                  How It Works
                </h2>
                <div className="grid md:grid-cols-3 gap-8 text-center">
                  <div className="flex flex-col items-center group">
                    <div className="flex items-center justify-center size-16 bg-blue-100 text-blue-500 rounded-full mb-4 group-hover:bg-blue-500 group-hover:text-white transition-all duration-300 transform group-hover:scale-110">
                      <Plus className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800 mb-2">
                      1. Create or Discover
                    </h3>
                    <p className="text-slate-600">
                      Organizers can post their trek plans with all the details. Trekkers can browse and find 
                      adventures that match their interests and skill level.
                    </p>
                  </div>
                  
                  <div className="flex flex-col items-center group">
                    <div className="flex items-center justify-center size-16 bg-blue-100 text-blue-500 rounded-full mb-4 group-hover:bg-blue-500 group-hover:text-white transition-all duration-300 transform group-hover:scale-110">
                      <MessageCircle className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800 mb-2">
                      2. Connect with the Team
                    </h3>
                    <p className="text-slate-600">
                      Join a trek's group chat to discuss plans, ask questions, and get to know your fellow 
                      adventurers before you even hit the trail.
                    </p>
                  </div>
                  
                  <div className="flex flex-col items-center group">
                    <div className="flex items-center justify-center size-16 bg-blue-100 text-blue-500 rounded-full mb-4 group-hover:bg-blue-500 group-hover:text-white transition-all duration-300 transform group-hover:scale-110">
                      <CheckCircle className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800 mb-2">
                      3. Prepare & Go!
                    </h3>
                    <p className="text-slate-600">
                      Once everything is set, pack your bags, meet your new friends, and embark on an 
                      unforgettable journey together.
                    </p>
                  </div>
                </div>
              </div>

              {/* Safety First Section */}
              <div className="bg-slate-100 p-8 rounded-lg shadow-sm">
                <h2 className="text-3xl font-bold text-slate-800 mb-6 text-center">
                  Safety First: Our Commitment
                </h2>
                <div className="grid md:grid-cols-2 gap-6 text-slate-600 leading-relaxed">
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
              <div>
                <h2 className="text-3xl font-bold text-slate-800 mb-6 border-l-4 border-blue-500 pl-4">
                  Organizer Responsibilities
                </h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  Trek Organizers are the backbone of our community. To ensure every trek is safe and enjoyable, 
                  we ask organizers to be clear, communicative, and responsible.
                </p>
                <ul className="list-disc list-inside space-y-2 text-slate-600">
                  <li>Provide accurate and detailed trek information (difficulty, distance, gear required).</li>
                  <li>Facilitate pre-trek communication to ensure everyone is prepared.</li>
                  <li>Promote a 'leave no trace' ethos.</li>
                  <li>Have a clear plan for emergencies.</li>
                  <li>Assess the group's overall fitness and experience level.</li>
                </ul>
              </div>

              {/* Community Guidelines Section */}
              <div>
                <h2 className="text-3xl font-bold text-slate-800 mb-6 text-center">
                  Community Guidelines
                </h2>
                <p className="text-center text-slate-600 max-w-2xl mx-auto mb-8">
                  To maintain a respectful, safe, and enjoyable environment for everyone, we ask all members 
                  of the Trek Buddies community to adhere to the following principles:
                </p>
                <div className="grid md:grid-cols-3 gap-8">
                  <div className="bg-slate-50 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-300">
                    <h3 className="text-xl font-semibold text-slate-800 mb-3">
                      Be Respectful
                    </h3>
                    <p className="text-slate-600">
                      Treat fellow trekkers, organizers, and the natural environment with kindness and 
                      consideration. We have a zero-tolerance policy for harassment or discrimination.
                    </p>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-300">
                    <h3 className="text-xl font-semibold text-slate-800 mb-3">
                      Be Honest
                    </h3>
                    <p className="text-slate-600">
                      Be transparent about your trekking experience and physical fitness. Organizers should 
                      provide clear and accurate details about the trek.
                    </p>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-300">
                    <h3 className="text-xl font-semibold text-slate-800 mb-3">
                      Be Reliable
                    </h3>
                    <p className="text-slate-600">
                      If you commit to a trek, show up prepared and on time. If your plans change, communicate 
                      promptly with your organizer and group.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Call to Action */}
            <div className="text-center mt-16">
              <p className="text-xl text-slate-700 mb-6">
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

