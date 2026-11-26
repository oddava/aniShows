import CatalogPage from './catalog/CatalogPage';
import { peopleConfig } from './catalog/configs';

export default function People() {
    return <CatalogPage config={peopleConfig} />;
}
