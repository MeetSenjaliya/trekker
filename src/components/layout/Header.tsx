'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X, Bell, Search, User, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, loading, signOut } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleSignOut = async () => {
    await signOut();
    setIsMenuOpen(false);
  };

  const linkStyles = "text-blue-100/80 hover:text-white text-sm font-medium transition-colors duration-200 tracking-wide";

  return (
    // UPDATED: Changed 'sticky' to 'fixed w-full'
    // This allows the AboutPage gradient to slide BEHIND the navbar
    <header
      className={`fixed top-0 w-full z-50 transition-all duration-500 border-b backdrop-blur-md
      ${scrolled
          ? 'bg-[#1b2735]/80 border-white/10 shadow-lg' // Scrolled: Dark Glass
          : 'bg-transparent border-transparent'         // Top: Full Transparency (shows page gradient)
        }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo Section */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]">
              <svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
              </svg>
            </div>
            <Link href="/" className="text-xl font-bold text-white tracking-tight drop-shadow-md">
              Trek Buddies
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <Link href="/" className={linkStyles}>Home</Link>
            <Link href="/about" className={linkStyles}>About</Link>
            <Link href="/explore" className={linkStyles}>Explore Treks</Link>

            {user && (
              <>
                <Link href="/favorites" className={linkStyles}>Favorites</Link>
                <Link href="/profile" className={linkStyles}>Profile</Link>
                <Link href="/messages" className={linkStyles}>Messages</Link>
              </>
            )}
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-4">

            {/* Search Bar */}
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-blue-200/50 group-focus-within:text-blue-300 transition-colors w-4 h-4" />
              <input
                type="text"
                placeholder="Search..."
                className="pl-10 pr-4 py-1.5 bg-[#090a0f]/20 border border-white/10 rounded-full text-sm text-white placeholder-blue-200/30 focus:outline-none focus:ring-1 focus:ring-blue-400/50 focus:bg-[#090a0f]/40 transition-all w-48 hover:w-64 duration-300"
              />
            </div>

            {user && (
              <button className="p-2 text-blue-100/70 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                <Bell className="w-5 h-5" />
              </button>
            )}

            {loading ? (
              <div className="w-8 h-8 bg-white/10 rounded-full animate-pulse"></div>
            ) : user ? (
              <div className="flex items-center gap-3 border-l border-white/10 pl-4 ml-2">
                <Link
                  href="/profile"
                  className="flex items-center gap-2 text-blue-100/80 hover:text-white text-sm font-medium transition-colors"
                >
                  <div className="bg-gradient-to-tr from-blue-600 to-blue-400 p-0.5 rounded-full">
                    <div className="bg-[#1b2735] rounded-full p-1">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                  <span className="hidden lg:inline font-light">{user.user_metadata?.full_name?.split(' ')[0] || 'User'}</span>
                </Link>
                <button
                  onClick={handleSignOut}
                  className="p-2 text-red-300/70 hover:text-red-300 hover:bg-red-500/10 rounded-full transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href="/auth/login"
                  className="text-blue-100/80 hover:text-white text-sm font-medium transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/auth/signup"
                  className="bg-white/5 hover:bg-white/10 border border-white/20 text-white px-5 py-1.5 rounded-full text-sm font-semibold transition-all backdrop-blur-md shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={toggleMenu}
              className="p-2 text-blue-100/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {isMenuOpen && (
          <div
            className="md:hidden absolute top-16 left-0 right-0 border-b border-white/10 backdrop-blur-xl shadow-2xl animate-in slide-in-from-top-2"
            style={{ background: 'linear-gradient(to bottom, rgba(27, 39, 53, 0.95) 0%, rgba(9, 10, 15, 0.98) 100%)' }}
          >
            {/* Mobile content remains the same... */}
            <div className="flex flex-col space-y-2 p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/50 w-4 h-4" />
                <input type="text" placeholder="Search..." className="w-full pl-10 pr-4 py-2.5 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-blue-400/50" />
              </div>
              <Link href="/" onClick={() => setIsMenuOpen(false)} className="text-white/80 hover:bg-white/10 px-3 py-2 rounded-lg block">Home</Link>
              <Link href="/about" onClick={() => setIsMenuOpen(false)} className="text-white/80 hover:bg-white/10 px-3 py-2 rounded-lg block">About</Link>
              <Link href="/explore" onClick={() => setIsMenuOpen(false)} className="text-white/80 hover:bg-white/10 px-3 py-2 rounded-lg block">Explore Treks</Link>

              {user ? (
                <>
                  <div className="h-px bg-white/10 my-2"></div>
                  <Link href="/favorites" onClick={() => setIsMenuOpen(false)} className="text-white/80 hover:bg-white/10 px-3 py-2 rounded-lg block">Favorites</Link>
                  <Link href="/profile" onClick={() => setIsMenuOpen(false)} className="text-white/80 hover:bg-white/10 px-3 py-2 rounded-lg block">Profile</Link>
                  <Link href="/messages" onClick={() => setIsMenuOpen(false)} className="text-white/80 hover:bg-white/10 px-3 py-2 rounded-lg block">Messages</Link>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left text-red-300 hover:bg-red-500/10 px-3 py-2 rounded-lg flex items-center gap-2 mt-2"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <div className="h-px bg-white/10 my-2"></div>
                  <Link href="/auth/login" onClick={() => setIsMenuOpen(false)} className="text-white/80 hover:bg-white/10 px-3 py-2 rounded-lg block">Login</Link>
                  <Link href="/auth/signup" onClick={() => setIsMenuOpen(false)} className="bg-blue-600 text-white px-3 py-2 rounded-lg block text-center mt-2">Sign Up</Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;