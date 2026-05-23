import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Heart, Navigation2, Search, Star, Clock, Utensils, DollarSign, Music, Sparkles, Award, AlertCircle, X, Bell, User, Compass, Filter, Bookmark } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const customStyles = `
  @keyframes pulse {
    0% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.5); opacity: 0.2; }
    100% { transform: scale(1); opacity: 0.8; }
  }
  .custom-map-pin { background: none !important; border: none !important; }
  .user-location-pin { background: none !important; border: none !important; }
  .custom-scrollbar::-webkit-scrollbar { width: 0px; background: transparent; }
  .leaflet-container { background: #0d0d0d !important; }
  .leaflet-popup-content-wrapper { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
  .leaflet-popup-tip-container { display: none !important; }
  .leaflet-popup-content { margin: 0 !important; width: auto !important; }
`;

interface FeedItem {
  id: string;
  type: 'FOOD TRUCK' | 'DISH' | 'RESTAURANT' | 'DEAL' | 'EVENT' | 'NEW MENU' | 'WORTH DISCOVERING';
  typeColor: string;
  image: string;
  title: string;
  subtitle: string;
  tag?: string;
  tagColor?: string;
  distance: string;
  hasRoute?: boolean;
}

const ScoutPrototype: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [activeCategory, setActiveCategory] = useState('For You');

  const categories = [
    { name: 'For You', icon: <Sparkles size={16} /> },
    { name: 'Community', icon: <User size={16} /> },
    { name: 'Nearby Now', icon: <Navigation2 size={16} /> },
    { name: 'Food Trucks', icon: <Utensils size={16} /> },
    { name: 'Restaurants', icon: <Utensils size={16} /> },
    { name: 'Deals', icon: <DollarSign size={16} /> },
    { name: 'Events', icon: <Clock size={16} /> },
    { name: 'New Menus', icon: <Star size={16} /> },
    { name: 'Late Night', icon: <Clock size={16} /> },
    { name: 'Worth Discovering', icon: <Award size={16} /> },
  ];

  const feedItems: FeedItem[] = [
    { id: '1', type: 'FOOD TRUCK', typeColor: '#9333ea', image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=400&fit=crop', title: 'Taco Bandito', subtitle: 'Mexican • Posted up 11a-3p', tag: 'Posted up now', tagColor: '#9333ea', distance: '0.3 mi' },
    { id: '2', type: 'DISH', typeColor: '#ff5c00', image: 'https://images.unsplash.com/photo-1473093226795-af9932fe5856?w=400&h=400&fit=crop', title: 'Cacio e Pepe', subtitle: 'Vinci Italian Kitchen • Italian', tag: 'Locals love this', tagColor: '#ff5c00', distance: '0.6 mi' },
    { id: '3', type: 'RESTAURANT', typeColor: '#ff5c00', image: 'https://images.unsplash.com/photo-1517248135467-4d71bcdd2167?w=400&h=400&fit=crop', title: 'Riverbend Café', subtitle: 'Café • Breakfast, Lunch • Open now', tag: 'Open now', tagColor: '#10b981', distance: '0.8 mi', hasRoute: true },
    { id: '4', type: 'DEAL', typeColor: '#10b981', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop', title: 'Burger + Fries', subtitle: 'Station House • 20% off', tag: 'Deal ends soon', tagColor: '#10b981', distance: '1.1 mi' },
    { id: '5', type: 'EVENT', typeColor: '#3b82f6', image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop', title: 'Live Music: Jordan Rivers', subtitle: 'The Green Room • Tonight 8PM', tag: 'Happening tonight', tagColor: '#3b82f6', distance: '0.9 mi' },
    { id: '6', type: 'NEW MENU', typeColor: '#ec4899', image: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=400&h=400&fit=crop', title: 'Strawberry Basque Cheesecake', subtitle: 'Sweet Science • New this week', tag: 'New menu item', tagColor: '#ec4899', distance: '0.7 mi' },
    { id: '7', type: 'WORTH DISCOVERING', typeColor: '#eab308', image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=400&fit=crop', title: "Mama Jean's Kitchen", subtitle: 'Soul Food • Newly added', tag: 'New to MealScout', tagColor: '#eab308', distance: '1.2 mi', hasRoute: true },
  ];

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = L.map(mapContainer.current, {
      zoomControl: false,
      attributionControl: false
    }).setView([40.7128, -74.0060], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map.current);

    // Custom pins based on target design
    const pins = [
      { lat: 40.718, lng: -74.008, color: '#9333ea', icon: '🚚' },
      { lat: 40.715, lng: -74.002, color: '#ff5c00', icon: '🍽️' },
      { lat: 40.712, lng: -74.010, color: '#3b82f6', icon: '🎸' },
      { lat: 40.720, lng: -74.005, color: '#10b981', icon: '🔥' },
      { lat: 40.708, lng: -74.004, color: '#eab308', icon: '⭐' },
    ];

    pins.forEach(p => {
      const icon = L.divIcon({
        className: 'custom-map-pin',
        html: `<div style="background-color: ${p.color}; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid rgba(255,255,255,0.3); box-shadow: 0 0 15px ${p.color}66;">
                <span style="font-size: 14px;">${p.icon}</span>
               </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      L.marker([p.lat, p.lng], { icon }).addTo(map.current!);
    });

    // User location
    const userIcon = L.divIcon({
      className: 'user-location-pin',
      html: `<div style="background-color: #3b82f6; width: 18px; height: 18px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 20px #3b82f6aa;">
                <div style="position: absolute; top: -8px; left: -8px; right: -8px; bottom: -8px; border-radius: 50%; background-color: #3b82f633; animation: pulse 2s infinite;"></div>
             </div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    L.marker([40.7128, -74.0060], { icon: userIcon }).addTo(map.current);

    // Sample popup
    const popupIcon = L.divIcon({
      className: 'custom-map-pin',
      html: `
        <div style="background: #1a1a1a; border: 1px solid #ff5c00; border-radius: 16px; padding: 12px; width: 220px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); position: relative;">
          <div style="display: flex; gap: 10px; margin-bottom: 12px;">
            <img src="https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;" />
            <div>
              <div style="font-size: 9px; font-weight: 800; color: #ff5c00; text-transform: uppercase;">DISH</div>
              <div style="font-size: 14px; font-weight: 700; color: white;">Brisket Tacos</div>
              <div style="font-size: 10px; color: #888;">Smok'd BBQ</div>
              <div style="font-size: 10px; color: #10b981; display: flex; align-items: center; gap: 2px;">
                <span style="color: #ff5c00;">⭐</span> Most loved nearby
              </div>
              <div style="font-size: 10px; color: #888;">0.4 mi • <span style="color: #10b981;">Open</span></div>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button style="flex: 1; background: #ff5c00; color: white; border: none; border-radius: 8px; padding: 6px; font-size: 11px; font-weight: 700;">View</button>
            <button style="flex: 1; background: #2a2a2a; color: white; border: 1px solid #444; border-radius: 8px; padding: 6px; font-size: 11px; font-weight: 700;">Route</button>
          </div>
          <div style="position: absolute; top: 8px; right: 8px; color: #888; font-size: 12px;">✕</div>
          <div style="position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 10px solid #1a1a1a;"></div>
        </div>
      `,
      iconSize: [220, 100],
      iconAnchor: [110, 110]
    });
    L.marker([40.716, -73.998], { icon: popupIcon }).addTo(map.current);

    return () => { map.current?.remove(); };
  }, []);

  return (
    <div className="h-screen w-full bg-[#0d0d0d] text-white flex flex-col overflow-hidden font-sans">
      <style>{customStyles}</style>
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 z-10">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-[#ff5c00] rounded-full flex items-center justify-center border-2 border-white/10 shadow-lg shadow-orange-900/20">
            <Utensils size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">MealScout</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Bell size={22} className="text-white/80" />
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#ff5c00] rounded-full border-2 border-[#0d0d0d]"></div>
          </div>
          <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
            <User size={18} className="text-white/80" />
          </div>
        </div>
      </div>

      {/* Map Section */}
      <div className="relative h-[40vh] w-full">
        <div ref={mapContainer} className="h-full w-full" />
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <button className="w-10 h-10 bg-[#1a1a1a]/80 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/80 shadow-xl">
            <Navigation2 size={20} />
          </button>
          <button className="w-10 h-10 bg-[#1a1a1a]/80 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/80 shadow-xl">
            <MapPin size={20} />
          </button>
        </div>
        <div className="absolute top-4 left-4">
           <div className="bg-[#1a1a1a]/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/60">Riverfront</div>
        </div>
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
           <div className="bg-[#1a1a1a]/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/60">Downtown</div>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex overflow-x-auto px-4 py-4 gap-3 no-scrollbar z-10 bg-[#0d0d0d]">
        {categories.map(cat => (
          <button
            key={cat.name}
            onClick={() => setActiveCategory(cat.name)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl whitespace-nowrap transition-all duration-300 border ${
              activeCategory === cat.name 
                ? 'bg-[#ff5c00] border-[#ff5c00] shadow-lg shadow-orange-900/30 text-white' 
                : 'bg-[#1a1a1a] border-white/5 text-white/60 hover:border-white/20'
            }`}
          >
            <span className={activeCategory === cat.name ? 'text-white' : 'text-orange-500'}>{cat.icon}</span>
            <span className="text-xs font-bold tracking-tight">{cat.name}</span>
          </button>
        ))}
      </div>

      {/* Feed Section */}
      <div className="flex-1 overflow-y-auto px-4 pb-32 custom-scrollbar">
        <div className="flex items-center justify-between mb-4 mt-2">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tighter leading-none mb-1">Today Around You</h2>
            <p className="text-[11px] leading-tight text-gray-400 font-medium">A live mix of what locals love, what's open, what's new, and what's nearby.</p>
          </div>
          <button className="text-orange-500 font-bold text-xs uppercase tracking-wider">See all</button>
        </div>

        <div className="space-y-3">
          {feedItems.map(item => (
            <div key={item.id} className="flex gap-3 bg-[#1a1a1a] rounded-2xl p-3 border border-white/5 group hover:border-orange-500/30 transition-all duration-300">
              <div className="relative w-24 h-24 shrink-0">
                <img src={item.image} className="w-full h-full object-cover rounded-xl" alt={item.title} />
              </div>
              <div className="flex-1 flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-black tracking-widest uppercase" style={{ color: item.typeColor }}>{item.type}</span>
                  {item.tag && (
                    <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold" style={{ backgroundColor: `${item.tagColor}15`, color: item.tagColor }}>{item.tag}</span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-white truncate mb-0.5">{item.title}</h3>
                <p className="text-[10px] text-gray-500 font-medium truncate mb-2">{item.subtitle}</p>
                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] font-bold text-gray-400">{item.distance}</span>
                  <div className="flex items-center gap-3">
                    <button className="text-[10px] font-black text-orange-500 uppercase tracking-widest">View</button>
                    {item.hasRoute && (
                      <button className="bg-orange-500 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-lg">Route</button>
                    )}
                    <Bookmark size={16} className="text-gray-600 hover:text-orange-500 transition-colors" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Search Bar */}
      <div className="fixed bottom-24 left-4 right-4 z-50">
        <div className="relative bg-[#1a1a1a]/90 backdrop-blur-xl border border-orange-500/30 rounded-full py-3 px-5 flex items-center gap-3 shadow-2xl shadow-black/50">
          <Sparkles size={18} className="text-orange-500" />
          <input 
            type="text" 
            placeholder="Ask Scout... tacos near me, live music, food trucks" 
            className="bg-transparent border-none outline-none text-[11px] font-medium text-white/80 placeholder:text-white/30 flex-1"
          />
          <Filter size={18} className="text-orange-500" />
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0d0d0d]/95 backdrop-blur-xl border-t border-white/5 flex items-center justify-around py-4 px-2 z-50">
        <button className="flex flex-col items-center gap-1 text-orange-500">
          <Compass size={22} />
          <span className="text-[9px] font-black uppercase tracking-widest">Scout</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-white/40 hover:text-white/80 transition-colors">
          <Search size={22} />
          <span className="text-[9px] font-black uppercase tracking-widest">Discover</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-white/40 hover:text-white/80 transition-colors">
          <Heart size={22} />
          <span className="text-[9px] font-black uppercase tracking-widest">Saved</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-white/40 hover:text-white/80 transition-colors">
          <div className="relative">
            <Bell size={22} />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#ff5c00] rounded-full border-2 border-[#0d0d0d]"></div>
          </div>
          <span className="text-[9px] font-black uppercase tracking-widest">Alerts</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-white/40 hover:text-white/80 transition-colors">
          <User size={22} />
          <span className="text-[9px] font-black uppercase tracking-widest">Profile</span>
        </button>
      </div>
    </div>
  );
};

export default ScoutPrototype;
