import CatalogPage from './catalog/CatalogPage';
import { genreConfig } from './catalog/configs';

export default function Genres() {
    return <CatalogPage config={genreConfig} />;
}
