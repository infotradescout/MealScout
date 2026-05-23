import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Heart, Navigation2, Search, Star, Clock, Utensils, DollarSign, Music, Sparkles, Award, AlertCircle, X } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface FeedItem {
  id: string;
  type: 'food_truck' | 'dish' | 'restaurant' | 'deal' | 'event' | 'new_menu' | 'worth_discovering';
  image: string;
  title: string;
  subtitle: string;
  distance: number;
  status?: string;
  statusColor?: string;
  tag?: string;
  tagColor?: string;
  saved?: boolean;
}

interface MapPinData {
  id: string;
  lat: number;
  lng: number;
  type: string;
  title: string;
  subtitle: string;
  image: string;
  distance: number;
  status: string;
}

const ScoutPrototype: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [activeCategory, setActiveCategory] = useState('for-you');
  const [selectedPin, setSelectedPin] = useState<MapPinData | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([
    {
      id: '1',
      type: 'food_truck',
      image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=300&h=300&fit=crop',
      title: 'Taco Bandito',
      subtitle: 'Mexican • Posted up 11a–3p',
      distance: 0.3,
      status: 'Posted up now',
      statusColor: 'text-purple-400',
      tag: 'FOOD TRUCK',
      tagColor: 'bg-purple-900 text-purple-300',
    },
    {
      id: '2',
      type: 'dish',
      image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=300&h=300&fit=crop',
      title: 'Cacio e Pepe',
      subtitle: 'Vinci Italian Kitchen • Italian',
      distance: 0.6,
      tag: 'DISH',
      tagColor: 'bg-orange-900 text-orange-300',
      status: 'Locals love this',
      statusColor: 'text-orange-400',
    },
    {
      id: '3',
      type: 'restaurant',
      image: 'https://images.unsplash.com/photo-1517248135467-4d71bcdd2167?w=300&h=300&fit=crop',
      title: 'Riverbend Café',
      subtitle: 'Café • Breakfast, Lunch',
      distance: 0.8,
      status: 'Open now',
      statusColor: 'text-green-400',
      tag: 'RESTAURANT',
      tagColor: 'bg-orange-900 text-orange-300',
    },
    {
      id: '4',
      type: 'deal',
      image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&h=300&fit=crop',
      title: 'Burger + Fries',
      subtitle: 'Station House • 20% off',
      distance: 1.1,
      status: 'Deal ends soon',
      statusColor: 'text-green-400',
      tag: 'DEAL',
      tagColor: 'bg-green-900 text-green-300',
    },
    {
      id: '5',
      type: 'event',
      image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop',
      title: 'Live Music: Jordan Rivers',
      subtitle: 'The Green Room • Tonight 8PM',
      distance: 0.9,
      status: 'Happening tonight',
      statusColor: 'text-blue-400',
      tag: 'EVENT',
      tagColor: 'bg-blue-900 text-blue-300',
    },
    {
      id: '6',
      type: 'new_menu',
      image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=300&fit=crop',
      title: 'Strawberry Basque Cheesecake',
      subtitle: 'Sweet Science • New this week',
      distance: 0.7,
      status: 'New menu item',
      statusColor: 'text-pink-400',
      tag: 'NEW MENU',
      tagColor: 'bg-pink-900 text-pink-300',
    },
    {
      id: '7',
      type: 'worth_discovering',
      image: 'https://images.unsplash.com/photo-1555939594-58d7cb561404?w=300&h=300&fit=crop',
      title: "Mama Jean's Kitchen",
      subtitle: 'Soul Food • Newly added',
      distance: 1.2,
      status: 'New to MealScout',
      statusColor: 'text-yellow-400',
      tag: 'WORTH DISCOVERING',
      tagColor: 'bg-yellow-900 text-yellow-300',
    },
  ]);

  const categories = [
    { id: 'for-you', label: 'For You', icon: '✨' },
    { id: 'community', label: 'Community', icon: '👥' },
    { id: 'nearby', label: 'Nearby Now', icon: '📍' },
    { id: 'trucks', label: 'Food Trucks', icon: '🚚' },
    { id: 'restaurants', label: 'Restaurants', icon: '🍽️' },
    { id: 'deals', label: 'Deals', icon: '🏷️' },
    { id: 'events', label: 'Events', icon: '📅' },
    { id: 'menus', label: 'New Menus', icon: '📋' },
    { id: 'late-night', label: 'Late Night', icon: '🌙' },
    { id: 'worth', label: 'Worth Discovering', icon: '⭐' },
  ];

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = L.map(mapContainer.current).setView([40.7128, -74.0060], 14);

    // Dark theme tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      maxZoom: 19,
    }).addTo(map.current);

    // Add sample pins
    const pins: MapPinData[] = [
      { id: '1', lat: 40.7128, lng: -74.0060, type: 'truck', title: 'Taco Bandito', subtitle: 'Mexican', image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop', distance: 0.3, status: 'Open' },
      { id: '2', lat: 40.7180, lng: -74.0020, type: 'restaurant', title: 'Riverbend Café', subtitle: 'Café', image: 'https://images.unsplash.com/photo-1517248135467-4d71bcdd2167?w=100&h=100&fit=crop', distance: 0.8, status: 'Open' },
      { id: '3', lat: 40.7100, lng: -74.0100, type: 'event', title: 'Live Music', subtitle: 'The Green Room', image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&h=100&fit=crop', distance: 0.9, status: 'Tonight' },
    ];

    pins.forEach(pin => {
      const iconColor = pin.type === 'truck' ? '#ff5c00' : pin.type === 'event' ? '#9333ea' : '#ff5c00';
      const icon = L.divIcon({
        html: `<div style="background-color: ${iconColor}; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px; border: 2px solid #1f2937;">🍽️</div>`,
        iconSize: [32, 32],
      });

      const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(map.current!);
      marker.on('click', () => setSelectedPin(pin));
    });

    // Add user location
    const userIcon = L.divIcon({
      html: `<div style="background-color: #3b82f6; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 2px #3b82f6;"></div>`,
      iconSize: [24, 24],
    });
    L.marker([40.7128, -74.0060], { icon: userIcon }).addTo(map.current);

    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, []);

  const toggleSave = (id: string) => {
    setFeedItems(feedItems.map(item => 
      item.id === id ? { ...item, saved: !item.saved } : item
    ));
  };

  return (
    <div className="h-screen w-full bg-[#0d0d0d] text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-[#1a1a1a] border-b border-[#333]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center text-sm font-bold">🍴</div>
          <span className="text-lg font-bold">MealScout</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="relative">
            <AlertCircle size={24} />
            <div className="absolute top-0 right-0 w-2 h-2 bg-orange-600 rounded-full"></div>
          </button>
          <button>
            <Navigation2 size={24} />
          </button>
        </div>
      </div>

      {/* Map Section */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={mapContainer} className="w-full h-full" />
        
        {/* Selected Pin Popup */}
        {selectedPin && (
          <div className="absolute bottom-20 left-4 right-4 bg-[#1a1a1a] rounded-lg p-4 border border-orange-600 shadow-lg z-50">
            <div className="flex gap-3">
              <img src={selectedPin.image} alt={selectedPin.title} className="w-16 h-16 rounded object-cover" />
              <div className="flex-1">
                <h3 className="font-bold text-white">{selectedPin.title}</h3>
                <p className="text-sm text-gray-400">{selectedPin.subtitle}</p>
                <p className="text-xs text-orange-400 mt-1">{selectedPin.distance} mi • {selectedPin.status}</p>
              </div>
              <button onClick={() => setSelectedPin(null)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <button className="flex-1 bg-orange-600 hover:bg-orange-700 text-white py-2 rounded font-semibold text-sm">View</button>
              <button className="flex-1 bg-[#333] hover:bg-[#444] text-white py-2 rounded font-semibold text-sm">Route</button>
            </div>
          </div>
        )}
      </div>

      {/* Category Filter Bar */}
      <div className="bg-[#1a1a1a] border-t border-[#333] overflow-x-auto">
        <div className="flex gap-2 p-3 min-w-max">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-semibold transition-all ${
                activeCategory === cat.id
                  ? 'bg-orange-600 text-white'
                  : 'bg-[#333] text-gray-300 hover:bg-[#444]'
              }`}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed Section */}
      <div className="flex-1 overflow-y-auto bg-[#0d0d0d]">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold">Today Around You</h2>
              <p className="text-sm text-gray-400">A live mix of what locals love, what's open, what's new, and what's nearby.</p>
            </div>
            <button className="text-orange-600 font-semibold text-sm">See all →</button>
          </div>

          <div className="space-y-3">
            {feedItems.map(item => (
              <div key={item.id} className="flex gap-3 bg-[#1a1a1a] rounded-lg p-3 border border-[#333] hover:border-orange-600 transition-colors">
                <img src={item.image} alt={item.title} className="w-24 h-24 rounded object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${item.tagColor}`}>{item.tag}</span>
                  </div>
                  <h3 className="font-bold text-white truncate">{item.title}</h3>
                  <p className="text-xs text-gray-400 truncate">{item.subtitle}</p>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{item.distance} mi</span>
                      {item.status && <span className={`text-xs font-semibold ${item.statusColor}`}>{item.status}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-orange-600 hover:text-orange-500 text-sm font-semibold">View</button>
                      <button onClick={() => toggleSave(item.id)} className={`${item.saved ? 'text-orange-600' : 'text-gray-500'} hover:text-orange-600`}>
                        <Heart size={16} fill={item.saved ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Search Bar */}
      <div className="bg-[#1a1a1a] border-t border-[#333] p-3">
        <div className="flex items-center gap-2 bg-[#333] rounded-full px-4 py-2 border border-orange-600">
          <Sparkles size={20} className="text-orange-600" />
          <input
            type="text"
            placeholder="Ask Scout... tacos near me, live music, food trucks"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
          <Search size={20} className="text-orange-600" />
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="bg-[#1a1a1a] border-t border-[#333] flex items-center justify-around p-3">
        <button className="flex flex-col items-center gap-1 text-orange-600">
          <Utensils size={24} />
          <span className="text-xs font-semibold">Scout</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white">
          <Search size={24} />
          <span className="text-xs font-semibold">Discover</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white">
          <Heart size={24} />
          <span className="text-xs font-semibold">Saved</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white">
          <AlertCircle size={24} />
          <span className="text-xs font-semibold">Alerts</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white">
          <Star size={24} />
          <span className="text-xs font-semibold">Profile</span>
        </button>
      </div>
    </div>
  );
};

export default ScoutPrototype;
