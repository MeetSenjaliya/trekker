'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors: {[key: string]: string} = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      try {
        const { signIn } = await import('@/lib/auth');
        const { user, error } = await signIn({
          email: formData.email,
          password: formData.password
        });

        if (error) {
          alert(`Login failed: ${error.message}`);
        } else if (user) {
          alert('Login successful!');
          // Redirect to home page
          window.location.href = '/';
        }
      } catch (error) {
        console.error('Login error:', error);
        alert('An unexpected error occurred. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      {/* <>
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-10 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 text-slate-900">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">T</span>
              </div>
              <h2 className="text-slate-900 text-xl font-bold leading-tight tracking-tight">
                Trek Buddies
              </h2>
            </Link>
            
            <div className="flex items-center gap-6">
              <nav className="hidden md:flex items-center gap-6">
                <Link href="/" className="text-slate-700 hover:text-slate-900 text-base font-medium transition-colors">
                  Home
                </Link>
                <Link href="/explore" className="text-slate-700 hover:text-slate-900 text-base font-medium transition-colors">
                  Explore Treks
                </Link>
                <Link href="/about" className="text-slate-700 hover:text-slate-900 text-base font-medium transition-colors">
                  About Us
                </Link>
              </nav>
              <Link 
                href="/auth/signup"
                className="flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-6 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-bold leading-normal tracking-wide transition-colors"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </header>
      </> */}

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center py-8 px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg p-8 sm:p-10">
            <div className="text-center mb-8">
              <h2 className="text-slate-900 text-3xl font-bold tracking-tight">
                Welcome Back
              </h2>
              <p className="text-slate-500 mt-2">
                Log in to continue your adventure.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium leading-6 text-slate-700 mb-2">
                  Username or Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={`block w-full rounded-xl border-0 py-3 px-4 text-slate-900 ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6 transition-shadow duration-200 ${
                    errors.email 
                      ? 'ring-red-300 focus:ring-red-600' 
                      : 'ring-slate-300 focus:ring-blue-600'
                  }`}
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium leading-6 text-slate-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className={`block w-full rounded-xl border-0 py-3 px-4 pr-12 text-slate-900 ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6 transition-shadow duration-200 ${
                      errors.password 
                        ? 'ring-red-300 focus:ring-red-600' 
                        : 'ring-slate-300 focus:ring-blue-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-red-600">{errors.password}</p>
                )}
              </div>

              {/* Remember Me & Forgot Password */}
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="rememberMe"
                    name="rememberMe"
                    type="checkbox"
                    checked={formData.rememberMe}
                    onChange={handleInputChange}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <label htmlFor="rememberMe" className="ml-3 block text-sm leading-6 text-slate-700">
                    Remember me
                  </label>
                </div>
                <div className="text-sm">
                  <Link 
                    href="/auth/forgot-password" 
                    className="font-semibold text-blue-600 hover:text-blue-500 transition-colors"
                  >
                    Forgot Password?
                  </Link>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="flex w-full justify-center rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold leading-6 text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors"
              >
                Login
              </button>
            </form>

            {/* Signup Link */}
            <p className="text-slate-600 text-sm font-normal leading-normal pt-6 text-center">
              Don't have an account?{' '}
              <Link href="/auth/signup" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}