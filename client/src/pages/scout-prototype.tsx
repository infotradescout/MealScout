import { useEffect, useRef, useState } from 'react';
import { MapPin, Heart, Navigation2, Search, Star, Clock, Utensils, DollarSign, Sparkles, Award, Bell, User, Compass, Filter, Bookmark, Truck } from 'lucide-react';
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
  .no-scrollbar::-webkit-scrollbar { width: 0px; height: 0px; background: transparent; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  .leaflet-container { background: #0d0d0d !important; }
  .leaflet-popup-content-wrapper { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
  .leaflet-popup-tip-container { display: none !important; }
  .leaflet-popup-content { margin: 0 !important; width: auto !important; }
`;

// SVG pin builder — no emoji, clean inline SVG icons
const svgPinHtml = (color: string, svgPath: string) => `
  <div style="
    background-color: ${color};
    width: 34px; height: 34px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid rgba(255,255,255,0.25);
    box-shadow: 0 0 14px ${color}88, 0 2px 8px rgba(0,0,0,0.6);
  ">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      ${svgPath}
    </svg>
  </div>
`;

const PIN_SVGS: Record<string, string> = {
  truck: '<rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};

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
  showRoute?: boolean;
}

const ScoutPrototype: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [activeCategory, setActiveCategory] = useState('For You');

  const categories = [
    { name: 'For You', icon: <Sparkles size={14} /> },
    { name: 'Community', icon: <User size={14} /> },
    { name: 'Nearby Now', icon: <Navigation2 size={14} /> },
    { name: 'Food Trucks', icon: <Truck size={14} /> },
    { name: 'Restaurants', icon: <Utensils size={14} /> },
    { name: 'Deals', icon: <DollarSign size={14} /> },
    { name: 'Events', icon: <Clock size={14} /> },
    { name: 'New Menus', icon: <Star size={14} /> },
    { name: 'Late Night', icon: <Clock size={14} /> },
    { name: 'Worth Discovering', icon: <Award size={14} /> },
  ];

  const feedItems: FeedItem[] = [
    {
      id: '1', type: 'FOOD TRUCK', typeColor: '#9333ea',
      image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=400&fit=crop',
      title: 'Taco Bandito', subtitle: 'Mexican • Posted up 11a–3p',
      tag: 'Posted up now', tagColor: '#9333ea', distance: '0.3 mi',
    },
    {
      id: '2', type: 'DISH', typeColor: '#ff5c00',
      image: 'https://images.unsplash.com/photo-1473093226795-af9932fe5856?w=400&h=400&fit=crop',
      title: 'Cacio e Pepe', subtitle: 'Vinci Italian Kitchen • Italian',
      tag: 'Locals love this', tagColor: '#ff5c00', distance: '0.6 mi',
    },
    {
      id: '3', type: 'RESTAURANT', typeColor: '#ff5c00',
      image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=400&fit=crop',
      title: 'Riverbend Café', subtitle: 'Café • Breakfast, Lunch • Open now',
      tag: 'Open now', tagColor: '#10b981', distance: '0.8 mi', showRoute: true,
    },
    {
      id: '4', type: 'DEAL', typeColor: '#10b981',
      image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop',
      title: 'Burger + Fries', subtitle: 'Station House • 20% off today',
      tag: 'Deal ends soon', tagColor: '#10b981', distance: '1.1 mi',
    },
    {
      id: '5', type: 'EVENT', typeColor: '#3b82f6',
      image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop',
      title: 'Live Music: Jordan Rivers', subtitle: 'The Green Room • Tonight 8PM',
      tag: 'Happening tonight', tagColor: '#3b82f6', distance: '0.9 mi',
    },
    {
      id: '6', type: 'NEW MENU', typeColor: '#ec4899',
      image: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=400&h=400&fit=crop',
      title: 'Strawberry Basque Cheesecake', subtitle: 'Sweet Science • New this week',
      tag: 'New menu item', tagColor: '#ec4899', distance: '0.7 mi',
    },
    {
      id: '7', type: 'WORTH DISCOVERING', typeColor: '#eab308',
      image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=400&fit=crop',
      title: "Mama Jean's Kitchen", subtitle: 'Soul Food • Newly added',
      tag: 'New to MealScout', tagColor: '#eab308', distance: '1.2 mi', showRoute: true,
    },
  ];

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = L.map(mapContainer.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([40.7128, -74.006], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map.current);

    // SVG-based pins — no emoji
    const pins = [
      { lat: 40.718, lng: -74.008, color: '#9333ea', type: 'truck' },
      { lat: 40.715, lng: -74.002, color: '#ff5c00', type: 'utensils' },
      { lat: 40.712, lng: -74.01,  color: '#3b82f6', type: 'music' },
      { lat: 40.72,  lng: -74.005, color: '#10b981', type: 'flame' },
      { lat: 40.708, lng: -74.004, color: '#eab308', type: 'star' },
    ];

    pins.forEach(p => {
      const icon = L.divIcon({
        className: 'custom-map-pin',
        html: svgPinHtml(p.color, PIN_SVGS[p.type]),
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      L.marker([p.lat, p.lng], { icon }).addTo(map.current!);
    });

    // User location dot with pulse ring
    const userIcon = L.divIcon({
      className: 'user-location-pin',
      html: `<div style="position:relative;width:18px;height:18px;">
               <div style="position:absolute;inset:-8px;border-radius:50%;background:#3b82f633;animation:pulse 2s infinite;"></div>
               <div style="width:18px;height:18px;border-radius:50%;background:#3b82f6;border:2.5px solid white;box-shadow:0 0 18px #3b82f6aa;"></div>
             </div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    L.marker([40.7128, -74.006], { icon: userIcon }).addTo(map.current);

    // No static popup card — popup overflows the map container

    return () => { map.current?.remove(); };
  }, []);

  return (
    <div className="h-screen w-full bg-[#0d0d0d] text-white flex flex-col overflow-hidden font-sans">
      <style>{customStyles}</style>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-[#ff5c00] rounded-full flex items-center justify-center border-2 border-white/10 shadow-lg shadow-orange-900/20">
            <Utensils size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">MealScout</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Bell size={22} className="text-white/80" />
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#ff5c00] rounded-full border-2 border-[#0d0d0d]" />
          </div>
          <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
            <User size={18} className="text-white/80" />
          </div>
        </div>
      </div>

      {/* ── Map — 25vh ── */}
      <div className="relative shrink-0 overflow-hidden" style={{ height: '25vh' }}>
        <div ref={mapContainer} className="h-full w-full" />
        {/* Map controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-[400]">
          <button className="w-10 h-10 bg-[#1a1a1a]/80 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/80 shadow-xl">
            <Navigation2 size={20} />
          </button>
          <button className="w-10 h-10 bg-[#1a1a1a]/80 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/80 shadow-xl">
            <MapPin size={20} />
          </button>
        </div>
        {/* Neighborhood labels */}
        <div className="absolute top-4 left-4 z-[400]">
          <div className="bg-[#1a1a1a]/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/60">
            Riverfront
          </div>
        </div>
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[400]">
          <div className="bg-[#1a1a1a]/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/60">
            Downtown
          </div>
        </div>
      </div>



      {/* ── Feed Section ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-[160px] no-scrollbar">
        {/* Section header */}
        <div className="flex items-center justify-between mb-3 mt-2">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tighter leading-none mb-1">Today Around You</h2>
            <p className="text-[11px] leading-tight text-gray-400 font-medium">
              A live mix of what locals love, what's open, what's new, and what's nearby.
            </p>
          </div>
          <button className="text-orange-500 font-bold text-xs uppercase tracking-wider shrink-0 ml-3">See all</button>
        </div>


        <div className="space-y-3">
          {feedItems.map(item => (
            <div
              key={item.id}
              className="flex gap-3 bg-[#1a1a1a] rounded-2xl p-3 border border-white/5 hover:border-orange-500/30 transition-all duration-300"
            >
              {/* Thumbnail */}
              <div className="w-24 h-24 shrink-0">
                <img
                  src={item.image}
                  className="w-full h-full object-cover rounded-xl"
                  alt={item.title}
                />
              </div>

              {/* Content */}
              <div className="flex-1 flex flex-col min-w-0 py-0.5">

                {/* Row 1: type label LEFT, distance RIGHT — same line */}
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className="text-[9px] font-black tracking-widest uppercase"
                    style={{ color: item.typeColor }}
                  >
                    {item.type}
                  </span>
                  <span className="text-[10px] font-bold text-gray-400 shrink-0 ml-2">{item.distance}</span>
                </div>

                {/* Row 2: title */}
                <h3 className="text-sm font-bold text-white truncate leading-tight mb-0.5">{item.title}</h3>

                {/* Row 3: subtitle */}
                <p className="text-[10px] text-gray-500 font-medium truncate mb-1.5">{item.subtitle}</p>

                {/* Row 4: tag badge — own line below subtitle */}
                {item.tag && (
                  <div className="mb-2">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[8px] font-bold"
                      style={{ backgroundColor: `${item.tagColor}18`, color: item.tagColor }}
                    >
                      {item.tag}
                    </span>
                  </div>
                )}

                {/* Row 5: actions */}
                <div className="flex items-center gap-3 mt-auto">
                  <button className="text-[10px] font-black text-orange-500 uppercase tracking-widest">View</button>
                  {item.showRoute && (
                    <button className="bg-[#1e1e1e] border border-white/10 text-white/80 text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-lg hover:border-orange-500/40 transition-colors">
                      Route
                    </button>
                  )}
                  <Bookmark size={15} className="text-gray-600 hover:text-orange-500 transition-colors ml-auto" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Explore the Scene — fixed single-row horizontal scroll above bottom nav ── */}
      <div className="fixed bottom-[62px] left-0 right-0 z-50 bg-[#111]/95 backdrop-blur-xl border-t border-white/5">
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-3 py-2.5">
          {[
            { label: 'Community', count: '87 new', icon: <User size={15} />, color: '#9333ea' },
            { label: 'Food Trucks', count: '6 now', icon: <Truck size={15} />, color: '#ff5c00' },
            { label: 'Restaurants', count: '42 open', icon: <Utensils size={15} />, color: '#ff5c00' },
            { label: 'Deals', count: '18 today', icon: <DollarSign size={15} />, color: '#10b981' },
            { label: 'Events', count: '7 tonight', icon: <Clock size={15} />, color: '#3b82f6' },
            { label: 'New Menus', count: '12 new', icon: <Star size={15} />, color: '#ec4899' },
            { label: 'Late Night', count: '15 open', icon: <Clock size={15} />, color: '#6366f1' },
            { label: 'Worth Discovering', count: '28 to try', icon: <Award size={15} />, color: '#eab308' },
          ].map(tile => (
            <button
              key={tile.label}
              className="shrink-0 flex flex-col items-center text-center bg-[#1a1a1a] rounded-xl px-2.5 py-2 border border-white/5 hover:border-orange-500/30 transition-all duration-200 gap-1.5 min-w-[68px]"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${tile.color}22` }}>
                <span style={{ color: tile.color }}>{tile.icon}</span>
              </div>
              <span className="text-[8px] font-black text-white leading-tight w-full">{tile.label}</span>
              <span className="text-[8px] font-bold leading-none" style={{ color: tile.color }}>{tile.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Bottom Navigation ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0d0d0d]/95 backdrop-blur-xl border-t border-white/5 flex items-center justify-around py-3.5 px-2 z-50">
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
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#ff5c00] rounded-full border-2 border-[#0d0d0d]" />
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
