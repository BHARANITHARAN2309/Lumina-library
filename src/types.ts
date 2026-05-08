export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  content?: string;
  genre?: string;
}

export interface SearchResult {
  books: Book[];
}
