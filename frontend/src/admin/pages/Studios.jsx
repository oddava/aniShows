import CatalogPage from './catalog/CatalogPage';
import { studioConfig } from './catalog/configs';

export default function Studios() {
    return <CatalogPage config={studioConfig} />;
}
