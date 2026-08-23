import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Award, MapPin, Trophy, TrendingUp } from 'lucide-react';

interface GoldenPlateRestaurant {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  cuisineType: string;
  logoUrl?: string;
  hasGoldenPlate: boolean;
  goldenPlateCount: number;
  goldenPlateEarnedAt: Date;
  rankingScore: number;
}

export default function GoldenPlateWinners() {
  const { data: winners, isLoading } = useQuery<GoldenPlateRestaurant[]>({
    queryKey: ['/api/awards/golden-plate/winners'],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[var(--bg-subtle)] rounded w-1/3"></div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-64 bg-[var(--bg-subtle)] rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Sort by goldenPlateCount (most awards) and then by ranking score
  const sortedWinners = [...(winners || [])]
    .sort((a, b) => {
      if (b.goldenPlateCount !== a.goldenPlateCount) {
        return b.goldenPlateCount - a.goldenPlateCount;
      }
      return b.rankingScore - a.rankingScore;
    });

  // Group by geographic area
  const winnersByArea = sortedWinners.reduce((acc, winner) => {
    const area = String(winner.city || winner.state || "Other").trim() || "Other";
    
    if (!acc[area]) {
      acc[area] = [];
    }
    acc[area].push(winner);
    return acc;
  }, {} as Record<string, GoldenPlateRestaurant[]>);

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-amber-500 to-yellow-600 text-white py-16">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center mb-6">
            <Award className="h-16 w-16 mr-4" />
            <h1 className="text-5xl font-bold">Golden Plate Winners</h1>
          </div>
          <p className="text-center text-xl max-w-2xl mx-auto">
            Celebrating the finest restaurants in each community. 
            Winners are selected every 90 days based on customer recommendations, 
            favorites, reviews, and overall excellence.
          </p>
        </div>
      </div>

      {/* Stats Section */}
      <div className="container mx-auto px-4 -mt-8">
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card className="bg-[var(--bg-surface)] shadow-clean-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-amber-600">
                    {sortedWinners.length}
                  </p>
                  <p className="text-[color:var(--text-muted)]">Total Winners</p>
                </div>
                <Award className="h-12 w-12 text-amber-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[var(--bg-surface)] shadow-clean-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-amber-600">
                    {Object.keys(winnersByArea).length}
                  </p>
                  <p className="text-[color:var(--text-muted)]">Areas Represented</p>
                </div>
                <MapPin className="h-12 w-12 text-amber-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[var(--bg-surface)] shadow-clean-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-amber-600">
                    {Math.max(...sortedWinners.map(w => w.goldenPlateCount || 0), 0)}
                  </p>
                  <p className="text-[color:var(--text-muted)]">Most Awards</p>
                </div>
                <TrendingUp className="h-12 w-12 text-amber-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Winners by Area */}
      <div className="container mx-auto px-4 pb-16">
        {Object.entries(winnersByArea).map(([area, areaWinners]) => (
          <div key={area} className="mb-12">
            <h2 className="text-3xl font-bold mb-6 flex items-center">
              <MapPin className="mr-2 h-8 w-8 text-amber-600" />
              {area}
            </h2>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {areaWinners.map((winner, index) => (
                <Link key={winner.id} href={`/restaurant/${winner.id}`}>
                  <Card className="hover:shadow-clean-lg transition-shadow cursor-pointer h-full bg-gradient-to-br from-white to-amber-50 border-2 border-amber-200">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-xl mb-2 flex items-center gap-2">
                            {winner.name}
                            {index === 0 && (
                              <Badge className="bg-amber-500">
                                #1 in {area}
                              </Badge>
                            )}
                          </CardTitle>
                          <p className="text-sm text-[color:var(--text-muted)]">{winner.cuisineType}</p>
                        </div>
                        {winner.logoUrl && (
                          <img 
                            src={winner.logoUrl} 
                            alt={winner.name}
                            className="w-16 h-16 rounded-lg object-cover"
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                    </CardHeader>

                    <CardContent>
                      <div className="space-y-3">
                        {/* Golden Plate Badge */}
                        <div className="flex items-center justify-center py-4 bg-gradient-to-r from-amber-400 to-yellow-500 rounded-lg">
                          <Award className="h-8 w-8 text-white mr-2" />
                          <div className="text-white">
                            <p className="font-bold text-lg">Golden Plate Winner</p>
                            {winner.goldenPlateCount > 1 && (
                              <p className="text-sm">
                                {winner.goldenPlateCount}x Champion
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <div className="text-center">
                            <p className="text-2xl font-bold text-amber-600">
                              {winner.rankingScore}
                            </p>
                            <p className="text-xs text-[color:var(--text-muted)]">Ranking Score</p>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center">
                              <Trophy className="h-5 w-5 text-amber-500" />
                              <span className="ml-1 text-2xl font-bold text-amber-600">
                                {winner.goldenPlateCount}
                              </span>
                            </div>
                            <p className="text-xs text-[color:var(--text-muted)]">Total Awards</p>
                          </div>
                        </div>

                        {/* Address */}
                        {(winner.address || winner.city || winner.state) && (
                          <div className="flex items-start text-sm text-[color:var(--text-muted)] pt-2 border-t">
                            <MapPin className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">
                              {winner.address || [winner.city, winner.state].filter(Boolean).join(", ")}
                            </span>
                          </div>
                        )}

                        {/* CTA */}
                        <Button className="w-full bg-amber-600 hover:bg-amber-700">
                          View Restaurant
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {sortedWinners.length === 0 && (
          <div className="text-center py-16">
            <Award className="h-24 w-24 text-[color:var(--text-muted)] mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-[color:var(--text-muted)] mb-2">
              No Golden Plate Winners Yet
            </h3>
            <p className="text-[color:var(--text-muted)]">
              Check back after the first quarterly awards ceremony!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}




