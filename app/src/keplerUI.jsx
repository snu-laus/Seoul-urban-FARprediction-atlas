import {
  BottomWidgetFactory,
  FloatingTimeDisplayFactory,
  MapControlFactory,
  PanelHeaderFactory,
  PanelToggleFactory,
  SidePanelFactory,
  injectComponents,
} from '@kepler.gl/components';

const createHiddenFactory = (BaseFactory) => {
  const HiddenFactory = () => () => null;
  HiddenFactory.deps = BaseFactory.deps;
  return HiddenFactory;
};

const HiddenSidePanelFactory = createHiddenFactory(SidePanelFactory);
const HiddenPanelToggleFactory = createHiddenFactory(PanelToggleFactory);
const HiddenMapControlFactory = createHiddenFactory(MapControlFactory);
const HiddenBottomWidgetFactory = createHiddenFactory(BottomWidgetFactory);
const HiddenFloatingTimeDisplayFactory = createHiddenFactory(FloatingTimeDisplayFactory);

const CustomPanelHeaderFactory = () => {
  const CustomPanelHeader = ({
    appName = 'Seoul Urban Atlas',
    version,
  }) => (
    <header className="custom-panel-header">
      <div className="custom-panel-header__title">
        <span className="custom-panel-header__badge">Project</span>
        <h2>{appName}</h2>
        <p>서울시 FAR 인사이트를 위한 맞춤 시각화 툴입니다.</p>
      </div>
      <div className="custom-panel-header__meta">
        {version ? <span className="custom-panel-header__version">v{version}</span> : null}
      </div>
    </header>
  );

  CustomPanelHeader.deps = PanelHeaderFactory.deps;
  return CustomPanelHeader;
};

CustomPanelHeaderFactory.deps = PanelHeaderFactory.deps;

const CustomKeplerGl = injectComponents([
  [PanelHeaderFactory, CustomPanelHeaderFactory],
  [SidePanelFactory, HiddenSidePanelFactory],
  [PanelToggleFactory, HiddenPanelToggleFactory],
  [MapControlFactory, HiddenMapControlFactory],
  [BottomWidgetFactory, HiddenBottomWidgetFactory],
  [FloatingTimeDisplayFactory, HiddenFloatingTimeDisplayFactory],
]);

export default CustomKeplerGl;
