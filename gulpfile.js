/* global process */
import path from 'path';

import { deleteAsync } from 'del';
import gulp from 'gulp';
import nodemon from 'gulp-nodemon';
import prettier from 'gulp-prettier';
import { default as run } from 'gulp-run-command';
import sourcemaps from 'gulp-sourcemaps';
import ts from 'gulp-typescript';
import merge from 'merge2';

import {
  generateSelectors,
  generateSchemas,
  generateOpenAPI,
} from './gulp.utils.js';

const runCmd = run.default;

const fileInSubDir = (parentDir, file) => {
  const relative = path.relative(parentDir, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

gulp.task('clean', () =>
  deleteAsync(['build', 'static/function/*js*', '.parcel-cache']),
);

gulp.task('tsc', () => {
  const tsProject = ts.createProject('tsconfig.json');
  const files = tsProject.src().pipe(tsProject());

  return merge([
    files.dts.pipe(gulp.dest('build')),
    files.js.pipe(sourcemaps.write('.')).pipe(gulp.dest('build')),
  ]);
});

gulp.task(
  'parcel:function',
  runCmd(
    "npx parcel build src/routes/chromium/utils/function/client.ts --target modern --no-source-maps --no-scope-hoist --log-level error --dist-dir ./static/function --public-url './'",
  ),
);

gulp.task('parcel', gulp.series(['parcel:function']));

gulp.task('prettier', () => {
  return gulp
    .src([
      '{src,functions,scripts}/**/*.{js,ts}',
      'gulpfile.js',
      'gulp.utils.js',
    ])
    .pipe(prettier({ config: '.prettierrc', logLevel: 'error', write: true }))
    .pipe(gulp.dest('./'));
});

gulp.task('lint', runCmd('npx eslint . --ext .ts --fix'));

gulp.task('generate:schemas', generateSchemas);

gulp.task('generate:selectors', generateSelectors);

gulp.task('generate:openapi', generateOpenAPI);

gulp.task(
  'install:browsers',
  runCmd('npx --yes playwright install chromium firefox webkit'),
);

gulp.task(
  'install:cdp-json',
  runCmd('node --no-warnings --loader ts-node/esm ./scripts/cdp-json.ts'),
);

gulp.task('install:dev', gulp.series('install:browsers', 'install:cdp-json'));
gulp.task('deploy', runCmd('npx ts-node scripts/deploy'));

gulp.task(
  'build',
  gulp.series(
    'clean',
    'tsc',
    'parcel',
    'generate:schemas',
    'generate:selectors',
    'generate:openapi',
  ),
);

gulp.task('serve:dev', (cb) => {
  const routesSrc = path.join(process.cwd(), 'src', 'routes');
  nodemon({
    // nodemon.json gets pulled automatically
    done: cb,
    tasks: (files) => {
      const routesWereModified = files.some((file) =>
        fileInSubDir(routesSrc, file),
      );
      return routesWereModified ? [] : [];
    },
  });
});
