import CatalogPage from './catalog/CatalogPage';
import { characterConfig } from './catalog/configs';

export default function Characters() {
    return <CatalogPage config={characterConfig} />;
}
