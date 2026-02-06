/**
 * Mock collection data for the Bookmarks app
 * Collections with correct place counts and references
 */

export const mockCollections = [
  {
    id: '1',
    name: 'Tourist Must-See',
    placeCount: 7,
    coverImage: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=400&h=400&fit=crop',
    places: ['tourist-1', 'tourist-2', 'tourist-3', 'tourist-4', 'tourist-5', 'tourist-6', 'tourist-7'],
    createdAt: '2024-01-15T10:00:00.000Z',
  },
  {
    id: '2',
    name: 'Weekend Activities',
    placeCount: 10,
    coverImage: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop',
    places: ['weekend-1', 'weekend-2', 'weekend-3', 'weekend-4', 'weekend-5', 'weekend-6', 'weekend-7', 'weekend-8', 'weekend-9', 'weekend-10'],
    createdAt: '2024-01-10T10:00:00.000Z',
  },
  {
    id: '3',
    name: 'Food Spots',
    placeCount: 3,
    coverImage: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=400&fit=crop',
    places: ['food-1', 'food-2', 'food-3'],
    createdAt: '2024-01-05T10:00:00.000Z',
  },
  {
    id: '4',
    name: 'Dublin Pubs',
    placeCount: 8,
    coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=400&fit=crop',
    places: ['pub-1', 'pub-2', 'pub-3', 'pub-4', 'pub-5', 'pub-6', 'pub-7', 'pub-8'],
    createdAt: '2024-01-01T10:00:00.000Z',
  },
];

export default mockCollections;
