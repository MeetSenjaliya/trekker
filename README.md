# Trek Buddies - Trekker Website with Supabase Backend

A modern, responsive Next.js application for trekking enthusiasts to discover, join, and organize trekking adventures. Built with TypeScript, Tailwind CSS, and Supabase for authentication and data management.

## Features

### 🔐 Authentication System
- **User Registration**: Complete signup flow with email verification
- **User Login**: Secure authentication with Supabase Auth
- **Password Reset**: Forgot password functionality with email reset links
- **Protected Routes**: Authentication-based navigation and access control

### 🏔️ Trekking Features
- **Trek Discovery**: Browse and search available treks
- **Trek Details**: Comprehensive trek information with gear lists and meeting points
- **Join Treks**: Interactive confirmation modal with safety guidelines
- **User Profiles**: Complete profile management with edit functionality
- **Reviews System**: Rate and review completed treks

### 📱 Responsive Design
- **Mobile-First**: Optimized for all device sizes
- **Modern UI**: Clean, professional design with smooth animations
- **Accessibility**: WCAG compliant with proper semantic markup

## Tech Stack

- **Frontend**: Next.js 15, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Supabase (Authentication, Database, Real-time)
- **Icons**: Lucide React
- **Deployment**: Vercel-ready

## Getting Started

### Prerequisites

- Node.js 18.0 or higher
- npm or yarn
- Supabase account

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd trekker-website
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Supabase**
   
   a. Create a new project at [supabase.com](https://supabase.com)
   
   b. Go to Settings > API to get your project URL and anon key
   
   c. Copy `.env.local.example` to `.env.local` and update with your Supabase credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ```

4. **Set up the database**
   
   a. Go to your Supabase project dashboard
   
   b. Navigate to SQL Editor
   
   c. Copy and run the SQL schema from `src/lib/supabase-schema.sql`

5. **Configure Authentication**
   
   a. In your Supabase dashboard, go to Authentication > Settings
   
   b. Configure your site URL (e.g., `http://localhost:3000` for development)
   
   c. Add redirect URLs for password reset: `http://localhost:3000/auth/reset-password`

6. **Run the development server**
   ```bash
   npm run dev
   ```

7. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── auth/              # Authentication pages
│   │   ├── login/         # Login page
│   │   ├── signup/        # Registration page
│   │   └── forgot-password/ # Password reset page
│   ├── about/             # About page
│   ├── explore/           # Trek discovery page
│   ├── profile/           # User profile pages
│   │   └── edit/          # Profile editing
│   ├── review/            # Reviews page
│   └── trek/[id]/         # Dynamic trek detail pages
├── components/            # Reusable React components
│   ├── layout/            # Layout components
│   │   ├── Header.tsx     # Navigation header
│   │   └── Footer.tsx     # Site footer
│   └── ui/                # UI components
│       ├── TrekCard.tsx   # Trek display card
│       ├── ConfirmationModal.tsx # Join trek modal
│       ├── HeroSection.tsx # Landing page hero
│       ├── FilterSection.tsx # Trek filtering
│       └── ReviewForm.tsx # Review submission form
├── contexts/              # React contexts
│   └── AuthContext.tsx    # Authentication state management
├── lib/                   # Utility libraries
│   ├── supabase.ts        # Supabase client configuration
│   ├── auth.ts            # Authentication utilities
│   ├── database.ts        # Database operations
│   └── supabase-schema.sql # Database schema
└── styles/                # Global styles
```

## Database Schema

The application uses the following main tables:

- **profiles**: User profile information
- **treks**: Trek listings and details
- **trek_participants**: Trek participation tracking
- **reviews**: Trek reviews and ratings

See `src/lib/supabase-schema.sql` for the complete schema with Row Level Security policies.

## Authentication Flow

1. **Registration**: Users sign up with email/password and full name
2. **Email Verification**: Supabase sends verification email
3. **Login**: Users authenticate with verified credentials
4. **Protected Access**: Authenticated users can access profile, join treks, and leave reviews
5. **Password Reset**: Users can reset passwords via email

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | Optional |

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy automatically

### Other Platforms

The application can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- DigitalOcean App Platform
- AWS Amplify

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support, please open an issue on GitHub or contact the development team.

---

Built with ❤️ for the trekking community

